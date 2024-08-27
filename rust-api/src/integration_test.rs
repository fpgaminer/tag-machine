use std::{
	collections::{HashMap, HashSet},
	process::Command,
};

use crate::database::{self, ImageHash};
use bollard::{exec::StartExecResults, Docker};
use futures::{StreamExt, TryStreamExt};
use sqlx::{
	postgres::{PgConnectOptions, PgPoolOptions},
	Executor, PgPool,
};
use tempfile::TempDir;

use rand::prelude::*;

#[actix_web::test]
async fn test_everything() {
	// Start a postgres instance using Docker
	let docker = DockerPostgres::new().await.unwrap();

	println!("Docker started: {}", docker.container_id);
	println!("Socket dir: {}", docker.socket_dir.path().to_str().unwrap());
	println!("Waiting for postgres to start...");

	// Wait for postgres to start
	docker.start().await.unwrap();

	// Sleep for a bit to make sure postgres is ready
	tokio::time::sleep(std::time::Duration::from_secs(5)).await;

	println!("Postgres started");

	// DB Pool
	let options = PgConnectOptions::new()
		.host(docker.socket_dir.path().join("socket").to_str().unwrap())
		.username("postgres")
		.password("password")
		.database("postgres");

	let db_pool = PgPoolOptions::new().max_connections(5).connect_with(options).await.unwrap();

	// Create the schema
	apply_schema(&db_pool, include_str!("../schema.sql")).await;

	// Start the server
	//let app = test::init_service(build_app(db_pool)).await;

	// Rng
	let mut rng = rand::thread_rng();

	// Add some tags
	let tag_names: Vec<String> = vec!["tag1".to_string(), "tag2".to_string(), "tag3".to_string(), "tag4".to_string()];

	for name in &tag_names {
		database::add_tag(&db_pool, name, 1).await.unwrap().unwrap();
	}

	// List tags to verify
	let tags = database::list_tags(&db_pool).await.unwrap();
	assert_eq!(
		tag_names.iter().cloned().collect::<HashSet<_>>(),
		tags.iter().map(|tag| tag.name.clone()).collect::<HashSet<_>>()
	);

	// Add some images
	let image_hashes: Vec<ImageHash> = vec![rng.gen(), rng.gen(), rng.gen()];

	for hash in &image_hashes {
		database::add_image(&db_pool, *hash, 1).await.unwrap().unwrap();
	}

	// List images to verify
	let images = database::list_images(&db_pool, 0, None).await.unwrap();
	assert_eq!(
		image_hashes.iter().cloned().collect::<HashSet<_>>(),
		images.iter().map(|image| image.hash).collect::<HashSet<_>>()
	);

	// Attributes for the images
	database::add_image_attribute(&db_pool, image_hashes[0], "attr1", "value_for_attr1", 1, true)
		.await
		.unwrap();
	database::add_image_attribute(&db_pool, image_hashes[0], "attr2", "value_for_attr2", 1, true)
		.await
		.unwrap();
	database::add_image_attribute(&db_pool, image_hashes[1], "attr1", "value_for_attr1 on image 2", 1, true)
		.await
		.unwrap();
	database::add_image_attribute(&db_pool, image_hashes[2], "attr1", "value_for_attr1 on image 3", 1, true)
		.await
		.unwrap();
	database::add_image_attribute(&db_pool, image_hashes[2], "attr2", "value_for_attr2 on image 3", 1, true)
		.await
		.unwrap();

	// Multi-value attributes
	database::add_image_attribute(&db_pool, image_hashes[0], "source", "source1", 1, false).await.unwrap();
	database::add_image_attribute(&db_pool, image_hashes[0], "source", "source2", 1, false).await.unwrap();
	database::add_image_attribute(&db_pool, image_hashes[0], "source", "source3", 1, false).await.unwrap();

	// Test removing an attribute
	database::remove_image_attribute(&db_pool, image_hashes[0], "attr2", "value_for_attr2", 1).await.unwrap().unwrap();
	database::remove_image_attribute(&db_pool, image_hashes[0], "source", "source2", 1).await.unwrap().unwrap();

	// Test editing an attribute
	database::add_image_attribute(&db_pool, image_hashes[1], "attr1", "new value for attr1 on image 2", 1, true)
		.await
		.unwrap();

	// Test captioning images
	database::edit_image_caption(&db_pool, image_hashes[0], "caption1", 1).await.unwrap().unwrap();
	database::edit_image_caption(&db_pool, image_hashes[1], "caption2", 1).await.unwrap().unwrap();
	database::edit_image_caption(&db_pool, image_hashes[1], "caption2-new", 1).await.unwrap().unwrap();

	// Test tagging images
	database::tag_image(&db_pool, image_hashes[0], "tag1", 1).await.unwrap().unwrap();
	database::tag_image(&db_pool, image_hashes[0], "tag2", 1).await.unwrap().unwrap();
	database::tag_image(&db_pool, image_hashes[0], "tag4", 1).await.unwrap().unwrap();
	database::tag_image(&db_pool, image_hashes[1], "tag1", 1).await.unwrap().unwrap();
	database::tag_image(&db_pool, image_hashes[1], "tag2", 1).await.unwrap().unwrap();
	database::tag_image(&db_pool, image_hashes[2], "tag3", 1).await.unwrap().unwrap();

	// Test untagging images
	database::untag_image(&db_pool, image_hashes[0], "tag1", 1).await.unwrap().unwrap();
	database::untag_image(&db_pool, image_hashes[1], "tag2", 1).await.unwrap().unwrap();

	// Test remove image
	database::remove_image(&db_pool, image_hashes[2], 1).await.unwrap().unwrap();

	// Test remove tag
	database::remove_tag(&db_pool, "tag4", 1).await.unwrap().unwrap();

	// Now compare state to what we expect
	struct ExpectedImage {
		attributes: HashMap<String, Vec<String>>,
		tags: HashSet<String>,
		caption: Option<String>,
	}
	let mut expected_images: HashMap<ImageHash, ExpectedImage> = HashMap::from_iter(vec![
		(
			image_hashes[0],
			ExpectedImage {
				attributes: HashMap::from_iter(vec![("attr1".to_string(), vec!["value_for_attr1".to_string()]), ("source".to_string(), vec!["source1".to_string(), "source3".to_string()]),]),
				tags: HashSet::from_iter(vec!["tag2".to_string(),]),
				caption: Some("caption1".to_owned()),
			},
		),
		(
			image_hashes[1],
			ExpectedImage {
				attributes: HashMap::from_iter(vec![("attr1".to_string(), vec!["new value for attr1 on image 2".to_string()]),]),
				tags: HashSet::from_iter(vec!["tag1".to_string(),]),
				caption: Some("caption2-new".to_owned()),
			},
		),
		(
			image_hashes[2],
			ExpectedImage {
				attributes: HashMap::from_iter(vec![]),
				tags: HashSet::from_iter(vec![]),
				caption: None,
			},
		),
	]);

	let db_images = database::list_images(&db_pool, 0, None)
		.await
		.unwrap()
		.into_iter()
		.map(|image| (image.hash, image))
		.collect::<HashMap<_, _>>();

	let tag_id_to_name = database::list_tags(&db_pool)
		.await
		.unwrap()
		.into_iter()
		.map(|tag| (tag.id, tag.name))
		.collect::<HashMap<_, _>>();

	for (hash, db_image) in &db_images {
		let expected_image = expected_images.get_mut(hash).expect("Unexpected image");

		// Attributes
		let mut db_attributes = db_image
			.attributes
			.iter()
			.map(|(key, value)| (key.clone(), value.clone()))
			.collect::<HashMap<_, _>>();

		// Sort the values
		for value in db_attributes.values_mut() {
			value.sort();
		}

		assert_eq!(db_attributes, expected_image.attributes);

		// Tags
		let db_tags = db_image.tags.iter().map(|tag| tag_id_to_name[tag].clone()).collect::<HashSet<_>>();
		assert_eq!(db_tags, expected_image.tags);

		// Caption
		assert_eq!(db_image.caption, expected_image.caption);

		// Remove from expected
		expected_images.remove(hash);
	}

	assert_eq!(expected_images.len(), 0);

	// Tags
	let db_tags = database::list_tags(&db_pool).await.unwrap();

	assert_eq!(
		db_tags.iter().map(|tag| tag.name.clone()).collect::<HashSet<_>>(),
		HashSet::from_iter(vec!["tag1".to_string(), "tag2".to_string(), "tag3".to_string(), "tag4".to_string(),])
	);

	for tag in &db_tags {
		if tag.name == "tag4" {
			assert_eq!(tag.active, false);
		} else {
			assert_eq!(tag.active, true);
		}
	}

	// Make sure the API returns an error if we try to add a tag with the same name
	assert!(database::add_tag(&db_pool, "tag1", 1).await.unwrap().is_err());

	// Make sure the API returns an error if we try to add an image with the same hash
	assert!(database::add_image(&db_pool, image_hashes[0], 1).await.unwrap().is_err());

	// Make sure the API returns an error if we try to tag an image with a tag that doesn't exist
	assert!(database::tag_image(&db_pool, image_hashes[0], "tag5", 1).await.unwrap().is_err());

	// Make sure the API returns an error if we try to untag an image with a tag that doesn't exist
	assert!(database::untag_image(&db_pool, image_hashes[0], "tag5", 1).await.unwrap().is_err());

	// Make sure the API returns an error if we try to remove an image that doesn't exist
	assert!(database::remove_image(&db_pool, rng.gen(), 1).await.unwrap().is_err());

	// Make sure the API returns an error if we try to remove a tag that doesn't exist
	assert!(database::remove_tag(&db_pool, "tag5", 1).await.unwrap().is_err());

	// Make sure the API returns an error if we try to edit an attribute on an image that doesn't exist
	assert!(database::add_image_attribute(&db_pool, rng.gen(), "attr1", "value", 1, true).await.is_err());

	// Make sure the API returns an error if we try to remove an attribute on an image that doesn't exist
	assert!(database::remove_image_attribute(&db_pool, rng.gen(), "attr1", "value", 1).await.unwrap().is_err());

	// Make sure the API returns an error if we try to re-tag an image with a tag that it already has
	assert!(database::tag_image(&db_pool, image_hashes[0], "tag2", 1).await.unwrap().is_err());

	// Make sure the API returns an error if we try to untag an image with a tag that it doesn't have
	assert!(database::untag_image(&db_pool, image_hashes[0], "tag3", 1).await.unwrap().is_err());

	// Make sure the API returns an error if we try to remove an attribute that doesn't exist
	assert!(database::remove_image_attribute(&db_pool, image_hashes[0], "attr3", "value", 1).await.unwrap().is_err());

	// Make sure the API returns an error if we try to caption an image that doesn't exist
	assert!(database::edit_image_caption(&db_pool, rng.gen(), "caption", 1).await.unwrap().is_err());

	// Make sure the API returns an error if we try to caption an image with the same caption
	assert!(database::edit_image_caption(&db_pool, image_hashes[0], "caption1", 1).await.unwrap().is_err());

	// Make sure the API returns an error if we try to edit an attribute with the same value
	assert!(database::add_image_attribute(&db_pool, image_hashes[0], "attr1", "value_for_attr1", 1, true).await.is_err());

	println!("Docker foo: {}", docker.container_id);
}

async fn apply_schema(db: &PgPool, sql: &str) {
	let mut tx = db.begin().await.unwrap();
	tx.execute(sql).await.unwrap();
	tx.commit().await.unwrap();
}

struct DockerPostgres {
	docker: Docker,
	socket_dir: TempDir,
	container_id: String,
}

impl DockerPostgres {
	async fn new() -> Result<Self, bollard::errors::Error> {
		let socket_dir = TempDir::new().unwrap();

		let docker = Docker::connect_with_local_defaults().unwrap();

		docker
			.create_image(
				Some(bollard::image::CreateImageOptions {
					from_image: "postgres:latest",
					tag: "latest",
					..Default::default()
				}),
				None,
				None,
			)
			.try_collect::<Vec<_>>()
			.await?;

		let host_config = bollard::models::HostConfig {
			auto_remove: Some(true),
			binds: Some(vec![format!("{}:/var/run/postgresql", socket_dir.path().join("socket").to_str().unwrap())]),
			shm_size: Some(1_000_000_000),
			..Default::default()
		};

		let container_config = bollard::container::Config {
			image: Some("postgres:latest"),
			env: Some(vec!["POSTGRES_PASSWORD=password"]),
			host_config: Some(host_config),
			..Default::default()
		};

		let id = docker.create_container::<&str, &str>(None, container_config).await?.id;

		Ok(Self {
			docker,
			socket_dir,
			container_id: id,
		})
	}

	async fn start(&self) -> Result<(), bollard::errors::Error> {
		self.docker.start_container::<String>(&self.container_id, None).await?;

		// Wait for postgres to be ready
		if !self.postgres_is_ready().await? {
			panic!("Postgres is not ready");
		}

		Ok(())
	}

	async fn postgres_is_ready(&self) -> Result<bool, bollard::errors::Error> {
		for _ in 0..50 {
			let exec = self
				.docker
				.create_exec(
					&self.container_id,
					bollard::exec::CreateExecOptions {
						attach_stdout: Some(true),
						attach_stderr: Some(true),
						cmd: Some(vec!["pg_isready", "-U", "postgres"]),
						..Default::default()
					},
				)
				.await?
				.id;

			if let StartExecResults::Attached { mut output, .. } = self.docker.start_exec(&exec, None).await? {
				while let Some(Ok(_)) = output.next().await {}
			} else {
				panic!("Failed to start exec");
			}

			// Check the exit code
			let inspect = self.docker.inspect_exec(&exec).await?;

			println!("Exit code: {:?}", inspect.exit_code);

			if inspect.exit_code == Some(0) {
				return Ok(true);
			}

			// Postgres is not ready yet, sleep and try again
			tokio::time::sleep(std::time::Duration::from_millis(100)).await;
		}

		Ok(false)
	}
}

impl Drop for DockerPostgres {
	fn drop(&mut self) {
		// Run `docker stop <container_id>`
		// This is a horrible hack, but I couldn't figure out a way to reliably stop the container using the bollard crate since it's async
		println!("Stopping container: {}", self.container_id);
		Command::new("docker").arg("stop").arg(&self.container_id).output().unwrap();
		println!("Stopped container: {}", self.container_id);
	}
}
