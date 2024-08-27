use std::{collections::{HashMap, HashSet}, hash::Hash, time::Instant};

use futures::{StreamExt, TryStreamExt};
use rand::prelude::Distribution;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{PgPool, QueryBuilder};

use crate::{errors::ApiError, search_query::{OrderBy, SearchOperator, SearchQuery, SearchSelect}};


#[derive(Serialize)]
pub struct Tag {
	pub id: i64,
	pub name: String,
	pub active: bool,
}


#[derive(Serialize)]
pub struct Image {
	pub id: i64,
	pub hash: ImageHash,
	pub active: bool,
	pub attributes: HashMap<String, Vec<String>>,
	pub tags: Vec<i64>,
	pub caption: Option<String>,
}

#[derive(Serialize)]
pub struct DbLog {
	pub id: i64,
	#[serde(serialize_with = "serialize_datetime_as_unix_timestamp")]
	pub timestamp: time::PrimitiveDateTime,
	pub user_id: i64,
	pub action: String,
	pub image_hash: Option<ImageHash>,
	pub tag: Option<String>,
	pub attribute_key: Option<String>,
	pub attribute_value: Option<String>,
}

fn serialize_datetime_as_unix_timestamp<S>(datetime: &time::PrimitiveDateTime, serializer: S) -> Result<S::Ok, S::Error>
where
	S: serde::Serializer,
{
	serializer.serialize_i64(datetime.assume_utc().unix_timestamp())
}

#[derive(Serialize)]
pub struct ImageWithBlame {
	pub id: i64,
	pub hash: ImageHash,
	pub active: bool,
	pub attributes: HashMap<String, Vec<String>>,
	pub tags_blame: HashMap<i64, i64>,
}


enum LogAction {
	AddTag(String),
	RemoveTag(String),
	AddImage(ImageHash),
	RemoveImage(ImageHash),
	AddAttribute {
		image_hash: ImageHash,
		key: String,
		value: String,
	},
	RemoveAttribute {
		image_hash: ImageHash,
		key: String,
		value: String,
	},
	AddImageTag(ImageHash, String),
	RemoveImageTag(ImageHash, String),
	CaptionImage(ImageHash, String),
}


#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct ImageHash(pub [u8; 32]);

impl ImageHash {
	pub fn from_bytes(bytes: [u8; 32]) -> Self {
		ImageHash(bytes)
	}
}

impl ToString for ImageHash {
	fn to_string(&self) -> String {
		hex::encode(self.0)
	}
}

impl Distribution<ImageHash> for rand::distributions::Standard {
	fn sample<R: rand::Rng + ?Sized>(&self, rng: &mut R) -> ImageHash {
		ImageHash(rng.gen())
	}
}

impl Serialize for ImageHash {
	fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
	where
		S: serde::Serializer,
	{
		serializer.serialize_str(&hex::encode(self.0))
	}
}

impl<'de> Deserialize<'de> for ImageHash {
	fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
	where
		D: serde::Deserializer<'de>,
	{
		let s = String::deserialize(deserializer)?;
		let bytes = hex::decode(s).map_err(serde::de::Error::custom)?;
		let hash = bytes.try_into().map_err(|_| serde::de::Error::custom("Invalid hash length"))?;
		Ok(ImageHash(hash))
	}
}

/*impl<'q> sqlx::Encode<'q, sqlx::Postgres> for ImageHash {
	fn encode_by_ref(&self, buf: &mut PgArgumentBuffer) -> sqlx::encode::IsNull {
		let foo = self.0;
		foo.encode_by_ref(buf)
	}
}*/

/// Get the maximum image ID.
pub async fn get_max_image_id(db: &PgPool) -> Result<i64, sqlx::Error> {
	let max_id = sqlx::query_scalar!("SELECT max(id) FROM images_2").fetch_one(db).await?;

	Ok(max_id.unwrap_or(0))
}


/// Given an image hash, get the image ID.
pub async fn get_image_id_from_hash(db: &PgPool, image_hash: ImageHash) -> Result<Option<i64>, sqlx::Error> {
	let id = sqlx::query_scalar!("SELECT id FROM images_2 WHERE hash = $1", &image_hash.0)
		.fetch_optional(db)
		.await?;

	Ok(id)
}


/// Given an image ID, get the image hash.
pub async fn get_image_hash_from_id(db: &PgPool, image_id: i64) -> Result<Option<ImageHash>, sqlx::Error> {
	let hash: Option<[u8; 32]> = sqlx::query_scalar("SELECT hash FROM images_2 WHERE id = $1")
		.bind(image_id)
		.fetch_optional(db)
		.await?;

	Ok(hash.map(ImageHash))
}


/// Get image by hash
pub async fn get_image_by_hash(db: &PgPool, image_hash: ImageHash) -> Result<Option<Image>, sqlx::Error> {
	let image = sqlx::query!("SELECT i.id, i.hash, i.active, i.tags, i.caption, json_agg(json_build_object('key', a.key, 'value', a.value)) FILTER (WHERE a.key IS NOT NULL AND a.value IS NOT NULL) AS attributes FROM images_2 i LEFT JOIN image_attributes a ON i.id = a.image_id WHERE i.hash = $1 GROUP BY i.id", &image_hash.0)
		.fetch_optional(db)
		.await?;

	Ok(image.map(|row| {
		let mut attributes: HashMap<String, Vec<String>> = HashMap::new();

		if let Some(attrs) = row.attributes {
			let attrs = attrs.as_array().expect("Invalid attributes array");
			let attrs = attrs.iter().map(|attr| attr.as_object().expect("Invalid attribute object"));

			for attr in attrs {
				let key = attr.get("key").unwrap().as_str().unwrap().to_string();
				let value = attr.get("value").unwrap().as_str().unwrap().to_string();
				attributes.entry(key).or_insert_with(Vec::new).push(value);
			}
		}

		Image {
			id: row.id,
			hash: ImageHash(row.hash.try_into().expect("Invalid hash length")),
			active: row.active,
			attributes,
			tags: row.tags,
			caption: row.caption,
		}
	}))
}


/// Get image by hash
pub async fn get_image_by_id(db: &PgPool, image_id: i64) -> Result<Option<Image>, sqlx::Error> {
	let image = sqlx::query!("SELECT i.id, i.hash, i.active, i.tags, i.caption, json_agg(json_build_object('key', a.key, 'value', a.value)) FILTER (WHERE a.key IS NOT NULL AND a.value IS NOT NULL) AS attributes FROM images_2 i LEFT JOIN image_attributes a ON i.id = a.image_id WHERE i.id = $1 GROUP BY i.id", image_id)
		.fetch_optional(db)
		.await?;

	Ok(image.map(|row| {
		let mut attributes: HashMap<String, Vec<String>> = HashMap::new();

		if let Some(attrs) = row.attributes {
			let attrs = attrs.as_array().expect("Invalid attributes array");
			let attrs = attrs.iter().map(|attr| attr.as_object().expect("Invalid attribute object"));

			for attr in attrs {
				let key = attr.get("key").unwrap().as_str().unwrap().to_string();
				let value = attr.get("value").unwrap().as_str().unwrap().to_string();
				attributes.entry(key).or_insert_with(Vec::new).push(value);
			}
		}

		Image {
			id: row.id,
			hash: ImageHash(row.hash.try_into().expect("Invalid hash length")),
			active: row.active,
			attributes,
			tags: row.tags,
			caption: row.caption,
		}
	}))
}


/// List image IDs in the database.
pub async fn list_image_ids(db: &PgPool) -> Result<Vec<i64>, sqlx::Error> {
	//let ids = sqlx::query_scalar!("SELECT id FROM images_2 ORDER BY id").fetch_all(db).await?;
	let ids: Vec<i64> = sqlx::query_scalar("SELECT id FROM images_2 ORDER BY id")
		.fetch_all(db)
		.await?;

	Ok(ids)
}


pub async fn search_images(
	db: &PgPool,
	select: Vec<SearchSelect>,
	limit: Option<i64>,
	order_by: Option<OrderBy>,
	operator: Option<SearchOperator>,
) -> Result<Vec<serde_json::Map<String, serde_json::Value>>, sqlx::Error> {
	let query = SearchQuery {
		select,
		order_by,
		limit,
		operator,
	};

	query.run(db).await
}

/// List images in the database.
/// min_id and is inclusive.
pub async fn list_images(db: &PgPool, min_id: i64, limit: Option<i64>) -> Result<Vec<Image>, sqlx::Error> {
	let limit = limit.unwrap_or(i64::MAX);

	struct ImageRow {
		id: i64,
		hash: Vec<u8>,
		active: bool,
		tags: Vec<i64>,
		attributes: Option<sqlx::types::JsonValue>,
		caption: Option<String>,
	}

	// Images
	let start_time = Instant::now();
	let images = sqlx::query_as!(
		ImageRow,
		"SELECT i.id, i.hash, i.active, i.tags, i.caption, json_agg(json_build_object('key', a.key, 'value', a.value)) FILTER (WHERE a.key IS NOT NULL AND a.value IS NOT NULL) AS attributes FROM images_2 i LEFT JOIN image_attributes a ON i.id = a.image_id WHERE i.id >= $1 GROUP BY i.id ORDER BY i.id LIMIT $2",
		min_id,
		limit
	)
	.fetch(db)
	.map_ok(|row| {
		let mut attributes = HashMap::new();

		if let Some(attrs) = row.attributes {
			let attrs = attrs.as_array().expect("Invalid attributes array");
			let attrs = attrs.iter().map(|attr| attr.as_object().expect("Invalid attribute object"));

			for attr in attrs {
				let key = attr.get("key").unwrap().as_str().unwrap().to_string();
				let value = attr.get("value").unwrap().as_str().unwrap().to_string();
				attributes.entry(key).or_insert_with(Vec::new).push(value);
			}
		}

		Image {
			id: row.id,
			hash: ImageHash(row.hash.try_into().expect("Invalid hash length")),
			active: row.active,
			attributes,
			tags: row.tags,
			caption: row.caption,
		}
	})
	.try_collect::<Vec<_>>()
	.await?;
	log::info!("list_images: images: {} ms", start_time.elapsed().as_millis());

	Ok(images)
}


/// Check if an image exists in the database.
pub async fn image_exists(db: &PgPool, image_hash: ImageHash) -> Result<bool, sqlx::Error> {
	get_image_id_from_hash(db, image_hash).await.map(|id| id.is_some())
}


async fn add_log_entry<'c, E>(db: E, user_id: i64, action: LogAction) -> Result<(), sqlx::Error>
where
	E: sqlx::Executor<'c, Database = sqlx::Postgres>,
{
	let (action, image_hash, tag, attribute_key, attribute_value) = match action {
		LogAction::AddTag(tag) => ("add_tag", None, Some(tag), None, None),
		LogAction::RemoveTag(tag) => ("remove_tag", None, Some(tag), None, None),
		LogAction::AddImage(image_hash) => ("add_image", Some(image_hash), None, None, None),
		LogAction::RemoveImage(image_hash) => ("remove_image", Some(image_hash), None, None, None),
		LogAction::AddAttribute { image_hash, key, value } => ("add_attribute", Some(image_hash), None, Some(key), Some(value)),
		LogAction::RemoveAttribute { image_hash, key, value } => ("remove_attribute", Some(image_hash), None, Some(key), Some(value)),
		LogAction::AddImageTag(image_hash, tag) => ("add_image_tag", Some(image_hash), Some(tag), None, None),
		LogAction::RemoveImageTag(image_hash, tag) => ("remove_image_tag", Some(image_hash), Some(tag), None, None),
		LogAction::CaptionImage(image_hash, caption) => ("caption", Some(image_hash), None, None, Some(caption)),
	};

	let image_hash_ref = image_hash.as_ref().map(|hash| &hash.0[..]);

	sqlx::query!(
		"INSERT INTO logs (user_id, action, image_hash, tag, attribute_key, attribute_value) VALUES ($1, $2, $3, $4, $5, $6)",
		user_id,
		action,
		image_hash_ref,
		tag,
		attribute_key,
		attribute_value
	)
	.execute(db)
	.await
	.map(|_| ())
}


/// Add an image to the database.
/// If it already exists and is active, an error will be returned.
pub async fn add_image(db: &PgPool, image_hash: ImageHash, user_id: i64) -> Result<Result<(), ()>, sqlx::Error> {
	let mut transaction = db.begin().await?;

	// Upsert
	let changes =
		sqlx::query!("INSERT INTO images_2 (hash, active, tags) VALUES ($1, $2, ARRAY[]::bigint[]) ON CONFLICT (hash) DO UPDATE SET active = EXCLUDED.active WHERE images_2.active = false", &image_hash.0, true)
			.execute(&mut *transaction)
			.await?;

	if changes.rows_affected() == 0 {
		// Image exists and is active, return error
		return Ok(Err(()));
	}

	// Log the action
	add_log_entry(&mut *transaction, user_id, LogAction::AddImage(image_hash)).await?;

	transaction.commit().await?;

	Ok(Ok(()))
}


/// Remove an image from the database.
/// If it does not exist or is inactive, an error will be returned.
pub async fn remove_image(db: &PgPool, image_hash: ImageHash, user_id: i64) -> Result<Result<(), ()>, sqlx::Error> {
	let mut transaction = db.begin().await?;

	let changes = sqlx::query!("UPDATE images_2 SET active = false, tags = ARRAY[]::bigint[], tags_blame = jsonb_build_object() WHERE hash = $1 AND active = true", &image_hash.0)
		.execute(&mut *transaction)
		.await?;

	if changes.rows_affected() == 0 {
		// Image does not exist or is inactive, return error
		return Ok(Err(()));
	}

	// Remove image attributes
	sqlx::query!("DELETE FROM image_attributes WHERE image_id = (SELECT id FROM images_2 WHERE hash = $1)", &image_hash.0)
		.execute(&mut *transaction)
		.await?;

	// Log the action
	add_log_entry(&mut *transaction, user_id, LogAction::RemoveImage(image_hash)).await?;

	// Commit
	transaction.commit().await?;

	Ok(Ok(()))
}

/// Given a tag name, get the tag ID.
pub async fn get_tag_id_from_name(db: &PgPool, tag_name: &str) -> Result<Option<i64>, sqlx::Error> {
	let id: Option<i64> = sqlx::query_scalar("SELECT id FROM tags WHERE tag = $1")
		.bind(tag_name)
		.fetch_optional(db)
		.await?;

	Ok(id)
}

/// Get tag from name.
pub async fn get_tag_by_name<'c, E>(db: E, tag_name: &str) -> Result<Option<Tag>, sqlx::Error>
where
	E: sqlx::Executor<'c, Database = sqlx::Postgres>,
{
	let tag: Option<(i64, String, bool)> = sqlx::query_as("SELECT id, tag, active FROM tags WHERE tag = $1")
		.bind(tag_name)
		.fetch_optional(db)
		.await?;

	Ok(tag.map(|(id, name, active)| Tag { id, name, active }))
}

/// List all tags in the database.
pub async fn list_tags(db: &PgPool) -> Result<Vec<Tag>, sqlx::Error> {
	let tags: Vec<(i64, String, bool)> = sqlx::query_as("SELECT id, tag, active FROM tags ORDER BY id").fetch_all(db).await?;

	Ok(tags.into_iter().map(|(id, name, active)| Tag { id, name, active }).collect::<Vec<_>>())
}

/// Add a tag to the database.
/// If it already exists and is active, an error will be returned.
pub async fn add_tag(db: &PgPool, name: &str, user_id: i64) -> Result<Result<(), ()>, sqlx::Error> {
	let mut transaction = db.begin().await?;

	// Upsert
	let changes = sqlx::query!(
		"INSERT INTO tags (tag, active) VALUES ($1, $2) ON CONFLICT (tag) DO UPDATE SET active = EXCLUDED.active WHERE tags.active = false",
		name,
		true
	)
	.execute(&mut *transaction)
	.await?;

	if changes.rows_affected() == 0 {
		// Tag exists and is active, return error
		return Ok(Err(()));
	}

	// Log the action
	add_log_entry(&mut *transaction, user_id, LogAction::AddTag(name.to_string())).await?;

	// Commit
	transaction.commit().await?;

	Ok(Ok(()))
}


/// Remove a tag from the database.
/// If it does not exist or is inactive, an error will be returned.
pub async fn remove_tag(db: &PgPool, name: &str, user_id: i64) -> Result<Result<(), ()>, sqlx::Error> {
	let mut transaction = db.begin().await?;

	let result: Option<(i64,)> = sqlx::query_as("UPDATE tags SET active = false WHERE tag = $1 AND active = true RETURNING id")
		.bind(name)
		.fetch_optional(&mut *transaction)
		.await?;

	let tag_id = match result {
		Some((tag_id,)) => tag_id,
		None => {
			// Tag does not exist or is inactive, return error
			return Ok(Err(()));
		},
	};

	// Remove tag from images
	sqlx::query!(
		"UPDATE images_2 SET tags = array_remove(tags, $1), tags_blame = tags_blame - $1::text WHERE $1 = ANY(tags)",
		tag_id
	)
	.execute(&mut *transaction)
	.await?;

	// Log the action
	add_log_entry(&mut *transaction, user_id, LogAction::RemoveTag(name.to_string())).await?;

	// Commit
	transaction.commit().await?;

	Ok(Ok(()))
}


/// Add an attribute to an image.
/// If the image does not exist or is not active, an error will be returned.
/// If that specific key-value attribute already exists, an error will be returned.
/// If singular is true, existing attributes with the same key will be removed.
pub async fn add_image_attribute(db: &PgPool, image_hash: ImageHash, key: &str, value: &str, user_id: i64, singular: bool) -> Result<(), ApiError> {
	let mut transaction = db.begin().await?;

	// Get the image id and grab a lock on the row to prevent concurrent updates
	// This is needed so that the log table stays in lock step with the rest of the database
	let (image_id, active) = match sqlx::query!("SELECT id, active FROM images_2 WHERE hash = $1 FOR UPDATE", &image_hash.0)
		.fetch_optional(&mut *transaction)
		.await? {
		Some(row) => (row.id, row.active),
		None => {
			// Image does not exist or is inactive, return error
			return Err(ApiError::ImageDoesNotExist);
		},
	};

	if !active {
		return Err(ApiError::ImageInactive);
	}

	if singular {
		// Remove existing attributes with the same key
		let values = sqlx::query!("DELETE FROM image_attributes WHERE image_id = $1 AND key = $2 AND value != $3 RETURNING value", image_id, key, value)
			.fetch_all(&mut *transaction)
			.await?;

		// Record the removal actions
		for row in values {
			add_log_entry(
				&mut *transaction,
				user_id,
				LogAction::RemoveAttribute {
					image_hash,
					key: key.to_string(),
					value: row.value,
				},
			)
			.await?;
		}
	}

	// Try to add the attribute
	let changes = sqlx::query!(
		"INSERT INTO image_attributes (image_id, key, value) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
		image_id,
		key,
		value
	)
	.execute(&mut *transaction)
	.await?;

	if changes.rows_affected() == 0 {
		// Attribute with that specific key-value already exists, return error
		return Err(ApiError::DuplicateAttribute);
	}

	// Log the action
	add_log_entry(
		&mut *transaction,
		user_id,
		LogAction::AddAttribute {
			image_hash,
			key: key.to_string(),
			value: value.to_string(),
		},
	)
	.await?;

	// Commit
	transaction.commit().await?;

	Ok(())
}


/// Remove an attribute from an image.
/// If the image does not exist or is not active, an error will be returned.
/// If that specific key-value attribute does not exist, an error will be returned.
pub async fn remove_image_attribute(db: &PgPool, image_hash: ImageHash, key: &str, value: &str, user_id: i64) -> Result<Result<(), ()>, sqlx::Error> {
	let mut transaction = db.begin().await?;

	// Get the image id and grab a lock on the row to prevent concurrent updates to this image's attributes
	let image_id = match sqlx::query_scalar!("SELECT id FROM images_2 WHERE hash = $1 AND active = true FOR UPDATE", &image_hash.0)
		.fetch_optional(&mut *transaction)
		.await? {
		Some(id) => id,
		None => {
			// Image does not exist or is inactive, return error
			return Ok(Err(()));
		},
	};

	// Try to remove the attribute
	let changes = sqlx::query!(
		"DELETE FROM image_attributes WHERE image_id = $1 AND key = $2 AND value = $3",
		image_id,
		key,
		value
	)
	.execute(&mut *transaction)
	.await?;

	if changes.rows_affected() == 0 {
		// Attribute does not exist, return error
		return Ok(Err(()));
	}

	// Log the action
	add_log_entry(
		&mut *transaction,
		user_id,
		LogAction::RemoveAttribute {
			image_hash,
			key: key.to_string(),
			value: value.to_string(),
		},
	)
	.await?;

	// Commit
	transaction.commit().await?;

	Ok(Ok(()))
}


/// Caption an image.
/// If the image does not exist or is not active, an error will be returned.
/// If the caption is already set to the new value, an error will be returned.
pub async fn edit_image_caption(db: &PgPool, image_hash: ImageHash, caption: &str, user_id: i64) -> Result<Result<(), ()>, sqlx::Error> {
	let mut transaction = db.begin().await?;

	// Try to update the caption
	let changes = sqlx::query!(
		"UPDATE images_2 SET caption = $1 WHERE hash = $2 AND active = true AND caption IS DISTINCT FROM $1",
		caption,
		&image_hash.0
	)
	.execute(&mut *transaction)
	.await?;

	if changes.rows_affected() == 0 {
		// Caption is already set to the new value, or image does not exist or is inactive, return error
		return Ok(Err(()));
	}

	// Log the action
	add_log_entry(&mut *transaction, user_id, LogAction::CaptionImage(image_hash, caption.to_string())).await?;

	// Commit
	transaction.commit().await?;

	Ok(Ok(()))
}


/// Tag an image.
/// If the image does not exist or is not active, an error will be returned.
/// If the tag does not exist or is not active, an error will be returned.
/// If the image is already tagged with the tag, an error will be returned.
pub async fn tag_image(db: &PgPool, image_hash: ImageHash, tag_name: &str, user_id: i64) -> Result<Result<(), ()>, sqlx::Error> {
	let mut transaction = db.begin().await?;

	// Get the tag id
	let tag = match get_tag_by_name(&mut *transaction, tag_name).await? {
		Some(tag) if tag.active => tag,
		_ => {
			// Tag does not exist or is inactive, return error
			return Ok(Err(()));
		},
	};

	// Try to add the tag
	let new_tags_blame = json!({ tag.id.to_string(): user_id });
	let changes = sqlx::query!(
		"UPDATE images_2
		 SET tags = array_append(tags, $1),
		     tags_blame = tags_blame || $3::jsonb
		WHERE hash = $2 AND active = true AND NOT ($1 = ANY(tags))",
		tag.id,
		&image_hash.0,
		new_tags_blame,
	)
	.execute(&mut *transaction)
	.await?;

	if changes.rows_affected() == 0 {
		// Image does not exist or is inactive or is already tagged with the tag, return error
		return Ok(Err(()));
	}

	// Log the action
	add_log_entry(&mut *transaction, user_id, LogAction::AddImageTag(image_hash, tag_name.to_string())).await?;

	// Commit
	transaction.commit().await?;

	Ok(Ok(()))
}


/// Untag an image.
/// If the image does not exist or is not active, an error will be returned.
/// If the tag does not exist or is not active, an error will be returned.
/// If the image is not tagged with the tag, an error will be returned.
pub async fn untag_image(db: &PgPool, image_hash: ImageHash, tag_name: &str, user_id: i64) -> Result<Result<(), ()>, sqlx::Error> {
	let mut transaction = db.begin().await?;

	// Get the tag id
	let tag = match get_tag_by_name(&mut *transaction, tag_name).await? {
		Some(tag) if tag.active => tag,
		_ => {
			// Tag does not exist or is inactive, return error
			return Ok(Err(()));
		},
	};

	// Try to remove the tag
	let changes = sqlx::query!(
		"UPDATE images_2 SET tags = array_remove(tags, $1), tags_blame = tags_blame - $1::text WHERE hash = $2 AND active = true AND $1 = ANY(tags)",
		tag.id,
		&image_hash.0,
	)
	.execute(&mut *transaction)
	.await?;

	if changes.rows_affected() == 0 {
		// Image does not exist or is inactive or is not tagged with the tag, return error
		return Ok(Err(()));
	}

	// Log the action
	add_log_entry(&mut *transaction, user_id, LogAction::RemoveImageTag(image_hash, tag_name.to_string())).await?;

	// Commit
	transaction.commit().await?;

	Ok(Ok(()))
}


pub async fn list_logs(
	db: &PgPool,
	image_hash: Option<ImageHash>,
	action: Option<String>,
	min_id: i64,
	limit: Option<i64>,
) -> Result<Vec<DbLog>, anyhow::Error> {
	let mut query = QueryBuilder::new("SELECT logs.id, timestamp, user_id, action, images_2.hash AS image_hash, tag, attribute_key, attribute_value FROM logs LEFT JOIN images_2 ON logs.image_hash = images_2.hash WHERE logs.id >= ");
	query.push_bind(min_id);

	if let Some(image_hash) = image_hash {
		query.push(" AND image_hash = ");
		query.push_bind(image_hash.0);
	}

	if let Some(action) = action {
		query.push(" AND action = ");
		query.push_bind(action);
	}

	query.push(" ORDER BY id ASC");

	if let Some(limit) = limit {
		query.push(" LIMIT ");
		query.push_bind(limit);
	}

	println!("{}", query.sql());

	let logs = query
		.build_query_as()
		.fetch(db)
		.map_ok(
			|(id, timestamp, user_id, action, image_hash, tag, attribute_key, attribute_value): (
				i64,
				time::PrimitiveDateTime,
				i64,
				String,
				Option<Vec<u8>>,
				Option<String>,
				Option<String>,
				Option<String>,
			)| {
				let image_hash = image_hash.map(|hash| ImageHash(hash.try_into().expect("Invalid hash length")));

				DbLog {
					id,
					timestamp,
					user_id,
					action,
					image_hash,
					tag,
					attribute_key,
					attribute_value,
				}
			},
		)
		.try_collect::<Vec<_>>()
		.await?;

	Ok(logs)
}


pub async fn list_images_with_blame(db: &PgPool, min_id: i64, limit: Option<i64>) -> Result<Vec<ImageWithBlame>, sqlx::Error> {
	let limit = limit.unwrap_or(i64::MAX);

	struct ImageRow {
		id: i64,
		hash: Vec<u8>,
		active: bool,
		attributes: Option<sqlx::types::JsonValue>,
		tags_blame: sqlx::types::JsonValue,
	}

	let images = sqlx::query_as!(
		ImageRow,
		"SELECT i.id, i.hash, i.active, i.tags_blame, json_agg(json_build_object('key', a.key, 'value', a.value)) FILTER (WHERE a.key IS NOT NULL AND a.value IS NOT NULL) AS attributes FROM images_2 i LEFT JOIN image_attributes a ON i.id = a.image_id WHERE i.id >= $1 GROUP BY i.id ORDER BY i.id LIMIT $2",
		min_id,
		limit
	)
	.fetch(db)
	.map_ok(|row| {
		let mut attributes = HashMap::new();

		if let Some(attrs) = row.attributes {
			let attrs = attrs.as_array().expect("Invalid attributes array");
			let attrs = attrs.iter().map(|attr| attr.as_object().expect("Invalid attribute object"));

			for attr in attrs {
				let key = attr.get("key").unwrap().as_str().unwrap().to_string();
				let value = attr.get("value").unwrap().as_str().unwrap().to_string();
				attributes.entry(key).or_insert_with(Vec::new).push(value);
			}
		}

		let tags_blame = row
			.tags_blame
			.as_object()
			.unwrap()
			.into_iter()
			.map(|(key, value)| (key.parse::<i64>().unwrap(), value.as_i64().unwrap()))
			.collect::<HashMap<_, _>>();
		ImageWithBlame {
			id: row.id,
			hash: ImageHash(row.hash.try_into().expect("Invalid hash length")),
			active: row.active,
			attributes,
			tags_blame,
		}
	})
	.try_collect::<Vec<_>>()
	.await?;

	Ok(images)
}


pub async fn set_image_embedding(db: &PgPool, image_hash: ImageHash, embedding_name: &str, embedding: &[u8]) -> Result<Result<(), ()>, sqlx::Error> {
	let column_name = match embedding_name {
		"embedding_1" => "embedding_1",
		_ => return Ok(Err(())),
	};
	let query = format!("UPDATE images_2 SET {} = $1 WHERE hash = $2 AND active = true", column_name);

	let changes = sqlx::query(&query).bind(embedding).bind(image_hash.0).execute(db).await?;

	if changes.rows_affected() == 0 {
		// Image does not exist or is inactive, return error
		return Ok(Err(()));
	}

	Ok(Ok(()))
}


pub fn list_image_embeddings<'a>(
	db: &'a PgPool,
	embedding_name: &str,
	min_id: i64,
	limit: Option<i64>,
) -> futures::stream::BoxStream<'a, Result<(i64, Vec<u8>), sqlx::Error>> {
	let query = match embedding_name {
		"embedding_1" => "SELECT id, embedding_1 FROM images_2 WHERE id >= $1 ORDER BY id ASC LIMIT $2",
		_ => return futures::stream::empty().boxed(),
	};
	let limit = limit.unwrap_or(i64::MAX);

	let images = sqlx::query_as(query).bind(min_id).bind(limit).fetch(db);

	images
}
