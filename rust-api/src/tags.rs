use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};


const TAG_ALIASES_JSON: &str = include_str!("../tag_aliases000000000000.json");
const TAG_IMPLICATIONS_JSON: &str = include_str!("../tag_implications000000000000.json");
const TAG_BLACKLIST_TXT: &str = include_str!("../tag_blacklist20231201.txt");
const TAG_DEPRECATIONS_TXT: &str = include_str!("../tag_deprecations20231201.txt");


#[derive(Clone, Serialize)]
pub struct TagMappings {
	aliases: HashMap<String, String>,
	implications: HashMap<String, HashSet<String>>,
	blacklist: HashSet<String>,
	deprecations: HashSet<String>,
}


pub fn get_tag_mappings() -> TagMappings {
	let aliases = read_tag_aliases();
	let implications = read_tag_implications();
	let blacklist = read_tag_blacklist();
	let deprecations = read_tag_deprecations();

	// Canonicalize tag implications by applying tag aliases
	let mut implications: HashMap<String, HashSet<String>> = implications
		.into_iter()
		.map(|(tag, implied_tags)| {
			let tag = aliases.get(&tag).unwrap_or(&tag).to_string();
			let implied_tags = implied_tags
				.into_iter()
				.map(|implied_tag| aliases.get(&implied_tag).unwrap_or(&implied_tag).to_string())
				.collect();
			(tag, implied_tags)
		})
		.collect();

	// Expand tag implications
	// This condenses chains of implications into a single mapping
	// For example, if "a" implies "b" and "b" implies "c", then "a" implies "b" and "c"
	loop {
		let mut implication_updates = HashMap::new();

		for (tag, implied_tags) in &implications {
			let new_implications: HashSet<String> = implied_tags
				.iter()
				.flat_map(|implied_tag| implications.get(implied_tag).unwrap_or(&HashSet::new()).clone())
				.collect();
			let new_implications: HashSet<String> = new_implications.difference(implied_tags).cloned().collect();

			if !new_implications.is_empty() {
				implication_updates.insert(tag.clone(), new_implications);
			}
		}

		if implication_updates.is_empty() {
			break;
		}

		for (tag, implied_tags) in implication_updates {
			implications.get_mut(&tag).unwrap().extend(implied_tags);
		}
	}

	TagMappings {
		aliases,
		implications,
		blacklist,
		deprecations,
	}
}


/// A mapping from aliased tags back to a canonical tag.
/// Given a tag like "ff7" as key, for example, the value would be "final_fantasy_vii".
fn read_tag_aliases() -> HashMap<String, String> {
	#[derive(Deserialize)]
	struct TagAlias {
		antecedent_name: String,
		consequent_name: String,
		status: String,
	}

	let aliases: Vec<TagAlias> = TAG_ALIASES_JSON.lines().map(|line| serde_json::from_str(line).unwrap()).collect();
	let mut alias_map = HashMap::new();

	for alias in aliases {
		// Only include active aliases
		if alias.status != "active" {
			continue;
		}

		// Assert that there are no self-aliases
		assert_ne!(alias.antecedent_name, alias.consequent_name, "Self-aliases found in tag aliases");

		// Assert that there are no duplicate antecedents
		// NOTE: Duplicate aliases are fine (they occur in the dataset for some reason)
		let consequent = alias_map.entry(alias.antecedent_name.clone()).or_insert(alias.consequent_name.clone());
		assert_eq!(consequent, &alias.consequent_name, "Duplicate antecedents found in tag aliases");
	}

	// Check for chains by ensuring that consequents are not also antecedents
	assert!(
		alias_map.values().all(|consequent| !alias_map.contains_key(consequent)),
		"Chains found in tag aliases"
	);

	alias_map
}


/// A mapping from a tag to a set of tags that it implies.
/// Given a tag like "mouse_ears" as key, for example, the value would have "animal_ears".
fn read_tag_implications() -> HashMap<String, HashSet<String>> {
	#[derive(Deserialize)]
	struct TagImplication {
		antecedent_name: String,
		consequent_name: String,
		status: String,
	}

	let implications: Vec<TagImplication> = TAG_IMPLICATIONS_JSON.lines().map(|line| serde_json::from_str(line).unwrap()).collect();
	let mut implications_map = HashMap::new();

	for implication in implications {
		// Only include active implications
		if implication.status != "active" {
			continue;
		}

		implications_map
			.entry(implication.antecedent_name.clone())
			.or_insert(HashSet::new())
			.insert(implication.consequent_name.clone());
	}

	implications_map
}


/// Returns a set of tags that are blacklisted.
fn read_tag_blacklist() -> HashSet<String> {
	TAG_BLACKLIST_TXT
		.lines()
		.map(|line| line.trim().to_string())
		.filter(|line| !line.is_empty())
		.collect()
}


/// Returns a set of tags that are deprecated.
fn read_tag_deprecations() -> HashSet<String> {
	TAG_DEPRECATIONS_TXT
		.lines()
		.map(|line| line.trim().to_string())
		.filter(|line| !line.is_empty())
		.collect()
}
