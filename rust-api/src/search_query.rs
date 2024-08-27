/// This code implements methods for dynamically building a Postgres query based on the user's search request
use futures::TryStreamExt;
use serde::Deserialize;
use serde_json::json;
use sqlx::postgres::PgRow;
use sqlx::PgPool;
use std::collections::HashMap;
use sqlx::Row;


const MAX_QUERY_DEPTH: u32 = 5;


#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "lowercase")]
pub enum OrderBy {
	Id,
	Hash,
}


#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SearchSelect {
	Id,
	Hash,
	Active,
	Tags,
	Caption,
	Attributes,
	Count,
	MinId,
	MaxId,
}

impl SearchSelect {
	pub fn to_string(&self) -> &'static str {
		match self {
			SearchSelect::Id => "i.id",
			SearchSelect::Hash => "i.hash",
			SearchSelect::Active => "i.active",
			SearchSelect::Tags => "i.tags",
			SearchSelect::Caption => "i.caption",
			SearchSelect::Attributes => "json_agg(json_build_object('key', a.key, 'value', a.value)) FILTER (WHERE a.key IS NOT NULL AND a.value IS NOT NULL) AS attributes",
			SearchSelect::Count => "count(*)",
			SearchSelect::MinId => "min(i.id)",
			SearchSelect::MaxId => "max(i.id)",
		}
	}

	pub fn to_json_name(&self) -> &'static str {
		match self {
			SearchSelect::Id => "id",
			SearchSelect::Hash => "hash",
			SearchSelect::Active => "active",
			SearchSelect::Tags => "tags",
			SearchSelect::Caption => "caption",
			SearchSelect::Attributes => "attributes",
			SearchSelect::Count => "count",
			SearchSelect::MinId => "min_id",
			SearchSelect::MaxId => "max_id",
		}
	}

	pub fn get_column(&self, row: &PgRow, map: &mut serde_json::Map<String, serde_json::Value>, index: usize) {
		let key = self.to_json_name().to_string();
		match self {
			SearchSelect::Id => {
				map.insert(key, serde_json::Value::Number(serde_json::Number::from(row.get::<i64, _>(index))));
			},
			SearchSelect::Hash => {
				let hash = row.get::<Vec<u8>, _>(index);
				map.insert(key, serde_json::Value::String(hex::encode(hash)));
			},
			SearchSelect::Active => {
				map.insert(key, serde_json::Value::Bool(row.get::<bool, _>(index)));
			},
			SearchSelect::Tags => {
				map.insert(key, serde_json::Value::Array(row.get::<Vec<i64>, _>(index).into_iter().map(|tag_id| serde_json::Value::Number(serde_json::Number::from(tag_id))).collect()));
			},
			SearchSelect::Caption => {
				let value = row.get::<Option<String>, _>(index);
				map.insert(key, json!(value));
			},
			SearchSelect::Attributes => {
				// SQL returns as a JSON array of key-value pairs.
				// For niceness, we want to convert this to a map of key -> [value1, value2, ...]
				let value = row.get::<sqlx::types::JsonValue, _>(index);
				let value = value.as_array().expect("Expected JSON array");
				let mut as_map = HashMap::new();
				for attr_pair in value {
					let attr_pair = attr_pair.as_object().expect("Expected JSON object");
					let key = attr_pair.get("key").expect("Expected key").as_str().expect("Expected string").to_string();
					let value = attr_pair.get("value").expect("Expected value").as_str().expect("Expected string").to_string();
					as_map.entry(key).or_insert_with(Vec::new).push(value);
				}
				let value = json!(as_map);

				map.insert(key, value);
			},
			SearchSelect::Count => {
				map.insert(key, serde_json::Value::Number(serde_json::Number::from(row.get::<i64, _>(index))));
			},
			SearchSelect::MinId => {
				map.insert(key, serde_json::Value::Number(serde_json::Number::from(row.get::<i64, _>(index))));
			},
			SearchSelect::MaxId => {
				map.insert(key, serde_json::Value::Number(serde_json::Number::from(row.get::<i64, _>(index))));
			},
		}

	}
}


#[derive(Deserialize, Debug)]
#[serde(rename_all = "lowercase")]
pub enum SearchOperator {
	Not(Box<SearchOperator>),
	And(Box<(SearchOperator, SearchOperator)>),
	Or(Box<(SearchOperator, SearchOperator)>),
	Tag(i64),
	Attribute(String, Option<String>),
	MinId(i64),
	MaxId(i64),
}


#[derive(Deserialize, Debug)]
pub struct SearchQuery {
	pub select: Vec<SearchSelect>,
	pub order_by: Option<OrderBy>,
	pub limit: Option<i64>,
	pub operator: Option<SearchOperator>,
}

enum AnyValue {
	Bool(bool),
	Int(i64),
	Float(f64),
	Text(String),
}

impl SearchOperator {
	fn write_sql(&self, query: &mut String, arguments: &mut Vec<AnyValue>, depth: u32, needs_attributes: &mut bool) -> Result<(), ()> {
		if depth > MAX_QUERY_DEPTH {
			return Err(());
		}

		match self {
			SearchOperator::Not(op) => {
				query.push_str(" NOT (");
				op.write_sql(query, arguments, depth + 1, needs_attributes)?;
				query.push_str(")");
			},
			SearchOperator::And(op) => {
				query.push_str(" (");
				op.0.write_sql(query, arguments, depth + 1, needs_attributes)?;
				query.push_str(") AND (");
				op.1.write_sql(query, arguments, depth + 1, needs_attributes)?;
				query.push_str(")");
			},
			SearchOperator::Or(op) => {
				query.push_str(" (");
				op.0.write_sql(query, arguments, depth + 1, needs_attributes)?;
				query.push_str(") OR (");
				op.1.write_sql(query, arguments, depth + 1, needs_attributes)?;
				query.push_str(")");
			},
			SearchOperator::Tag(tag_id) => {
				arguments.push(AnyValue::Int(*tag_id));
				query.push_str(format!(" ${} = ANY(tags)", arguments.len()).as_str());
			},
			SearchOperator::Attribute(key, Some(value)) if key == "id" => {
				arguments.push(AnyValue::Int(value.parse().map_err(|_| ())?));
				query.push_str(format!(" i.id = ${}", arguments.len()).as_str());
			},
			SearchOperator::Attribute(key, Some(value)) if key == "hash" => {
				arguments.push(AnyValue::Text(value.clone()));
				query.push_str(format!(" i.hash = decode(${}, 'hex')", arguments.len()).as_str());
			},
			SearchOperator::Attribute(key, Some(value)) if key == "caption" => {
				arguments.push(AnyValue::Text(value.clone()));
				query.push_str(format!(" i.caption = ${}", arguments.len()).as_str());
			},
			SearchOperator::Attribute(key, None) if key == "caption" => {
				query.push_str(" i.caption IS NULL");
			},
			SearchOperator::Attribute(key, Some(value)) if value == "*" => {
				arguments.push(AnyValue::Text(key.clone()));
				query.push_str(format!(" ${} = a.key", arguments.len()).as_str());
				*needs_attributes = true;
			},
			SearchOperator::Attribute(key, Some(value)) => {
				arguments.push(AnyValue::Text(key.clone()));
				arguments.push(AnyValue::Text(value.clone()));
				query.push_str(format!(" ${} = a.key AND decode(md5(${}),'hex') = a.value_md5", arguments.len() - 1, arguments.len()).as_str());
				*needs_attributes = true;
			},
			SearchOperator::Attribute(_, None) => {
				// Not currently supported
			},
			SearchOperator::MinId(min_id) => {
				arguments.push(AnyValue::Int(*min_id));
				query.push_str(format!(" i.id >= ${}", arguments.len()).as_str());
			},
			SearchOperator::MaxId(max_id) => {
				arguments.push(AnyValue::Int(*max_id));
				query.push_str(format!(" i.id <= ${}", arguments.len()).as_str());
			},
		}

		Ok(())
	}
}


impl SearchQuery {
	fn build_sql(&self) -> Result<(String, Vec<AnyValue>), ()> {
		let mut arguments = Vec::new();
		let mut needs_attributes = false;

		// Select
		let selects: Vec<_> = self.select.iter().map(|s| s.to_string()).collect();
		if self.select.len() == 0 {
			// Need to select at least one column
			return Err(());
		}
		
		if self.select.contains(&SearchSelect::Attributes) {
			needs_attributes = true;
		}

		if self.select.contains(&SearchSelect::Count) || self.select.contains(&SearchSelect::MinId) || self.select.contains(&SearchSelect::MaxId) {
			// If count, min, or max is selected, there can't be any other selects besides those
			if !self.select.iter().all(|s| s == &SearchSelect::Count || s == &SearchSelect::MinId || s == &SearchSelect::MaxId) {
				return Err(());
			}
		}

		// Where clauses
		let where_clauses = if let Some(operator) = &self.operator {
			let mut where_clauses = String::new();
			if operator.write_sql(&mut where_clauses, &mut arguments, 0, &mut needs_attributes).is_err() {
				return Err(());
			}
			Some(where_clauses)
		}
		else {
			None
		};

		// Joins
		let joins = if needs_attributes {
			" LEFT JOIN image_attributes a ON i.id = a.image_id"
		}
		else {
			""
		};

		// Group by
		let group_by = if self.select.contains(&SearchSelect::Attributes) {
			" GROUP BY i.id"
		}
		else {
			""
		};

		// Order by
		let order_by = if let Some(order_by) = &self.order_by {
			match order_by {
				OrderBy::Id => " ORDER BY i.id",
				OrderBy::Hash => " ORDER BY i.hash",
			}
		}
		else {
			""
		};

		// Limit
		let limit = if let Some(limit) = self.limit {
			if limit < 0 {
				return Err(());
			}
			Some(limit)
		}
		else {
			None
		};

		// Format query
		let selects = selects.join(", ");
		let mut query = format!("SELECT {} FROM images_2 i{}", selects, joins);

		if let Some(where_clauses) = where_clauses {
			query.push_str(" WHERE ");
			query.push_str(&where_clauses);
		}

		query.push_str(group_by);
		query.push_str(order_by);

		if let Some(limit) = limit {
			query.push_str(" LIMIT ");
			query.push_str(&limit.to_string());
		}

		/*let mut query = sqlx::query(&query);
		for arg in arguments.iter() {
			match arg {
				AnyValue::Bool(b) => query = query.bind(b),
				AnyValue::Int(i) => query = query.bind(i),
				AnyValue::Float(f) => query = query.bind(f),
				AnyValue::Text(t) => query = query.bind(t),
			}
		}*/

		Ok((query, arguments))
	}

	pub async fn run(&self, db: &PgPool) -> Result<Vec<serde_json::Map<String, serde_json::Value>>, sqlx::Error> {
		let (query, arguments) = self.build_sql().map_err(|_| sqlx::Error::Protocol("Invalid search query".to_string()))?;
		log::info!("Running query: {}", query);
		let mut query = sqlx::query(&query);
		for arg in arguments.iter() {
			match arg {
				AnyValue::Bool(b) => query = query.bind(b),
				AnyValue::Int(i) => query = query.bind(i),
				AnyValue::Float(f) => query = query.bind(f),
				AnyValue::Text(t) => query = query.bind(t),
			}
		}


		let result = query.fetch(db);
		let result = result.try_fold(
			Vec::new(),
			|mut images, row| async move {
				let mut image = serde_json::Map::new();

				for (i, select) in self.select.iter().enumerate() {
					select.get_column(&row, &mut image, i);
				}

				images.push(image);

				Ok(images)
			},
		)
		.await?;

		Ok(result)
	}
}