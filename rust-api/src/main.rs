mod database;
mod error;
#[cfg(test)]
mod integration_test;
mod tags;
mod search_query;
mod errors;

use std::{collections::HashMap, os::unix::fs::PermissionsExt, path::Path};

use actix_cors::Cors;
use actix_files::NamedFile;
use actix_multipart::form::{tempfile::TempFile, MultipartForm};
use actix_web::{
	body::MessageBody, dev::{ServiceFactory, ServiceRequest, ServiceResponse}, middleware::{self, Logger}, web::{self, Bytes, BytesMut, Data}, App, HttpRequest, HttpResponse, HttpServer
};
use anyhow::Context;
use database::ImageHash;
use env_logger::Env;
use errors::ApiError;
use futures::StreamExt;
use search_query::{OrderBy, SearchOperator, SearchSelect};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::{
	postgres::{PgConnectOptions, PgPoolOptions},
	PgPool,
};
use tags::TagMappings;
use tokio::io::AsyncReadExt;
use clap::Parser;

use crate::error::ServerError;
use image::{self, imageops, io::Reader as ImageReader};


#[derive(Parser, Debug)]
#[command()]
struct Args {
	/// IP address to bind to.
	#[arg(long, default_value = "127.0.0.1")]
	ip: String,

	/// Port to bind to (default: 8086).
	#[arg(long, default_value = "8086")]
	port: u16,
}


const IMAGE_DIR: &str = "images";
const UPLOAD_DIR: &str = "uploads";


#[actix_web::main]
async fn main() -> Result<(), anyhow::Error> {
	// Env logger
	env_logger::Builder::from_env(Env::default().default_filter_or("warn,actix_web=debug,rust_api=debug,actix_server=info")).init();

	// Parse command line arguments
	let args = Args::parse();

	// Read tag mappings
	let tag_mappings = tags::get_tag_mappings();

	// Setup database
	let db_pool = setup_database().await?;

	// Setup HTTP server
	let server = HttpServer::new(move || build_app(db_pool.clone(), tag_mappings.clone()))
		.bind((args.ip.as_str(), args.port))?
		.run();

	log::info!("Server running at http://127.0.0.1:8086");

	server.await?;

	Ok(())
}

async fn setup_database() -> anyhow::Result<PgPool> {
	let current_dir = std::env::current_dir().context("Failed to get current directory")?;
	let db_path = current_dir.parent().context("Failed to get parent directory")?.join("pg-socket");
	let options = PgConnectOptions::new()
		.host(db_path.to_str().context("Failed to convert path to string")?)
		.username("postgres")
		.password("password")
		.database("postgres");

	let db_pool = PgPoolOptions::new()
		.max_connections(16)
		.acquire_timeout(std::time::Duration::from_secs(120))
		.connect_with(options)
		.await
		.context("Failed to connect to database")?;

	Ok(db_pool)
}

pub fn build_app(
	db: PgPool,
	tag_mappings: TagMappings,
) -> App<impl ServiceFactory<ServiceRequest, Config = (), Response = ServiceResponse<impl MessageBody>, Error = actix_web::Error, InitError = ()>> {
	let logger = Logger::default();
	let cors = Cors::default()
		.allowed_origin("http://localhost:1420")
		.allowed_origin("http://localhost:4173")
		.allow_any_method()
		.allow_any_header()
		.max_age(3600);

	let tag_mappings = Data::new(tag_mappings);

	App::new()
		.wrap(logger)
		.wrap(cors)
		.wrap(middleware::Compress::default())
		.app_data(Data::new(db))
		.app_data(tag_mappings)
		.service(list_tags)
		.service(tag_by_name)
		.service(add_tag)
		.service(remove_tag)
		.service(list_images)
		.service(search_images)
		.service(list_image_ids)
		.service(image_by_hash)
		.service(image_by_id)
		.service(add_image)
		.service(remove_image)
		.service(add_image_attribute)
		.service(remove_image_attribute)
		.service(tag_image)
		.service(untag_image)
		.service(get_image)
		.service(get_image_by_id)
		.service(get_tag_mappings)
		.service(list_logs)
		.service(list_images_with_blame)
		.service(set_image_embedding)
		.service(list_image_embeddings)
		.service(upload_image)
		.service(caption_image)
}


/// List all tags in the database.
#[actix_web::get("/tags")]
async fn list_tags(db_pool: Data<PgPool>) -> Result<HttpResponse, ServerError> {
	let tags = database::list_tags(&db_pool).await?;
	let result = tags
		.into_iter()
		.map(|tag| {
			json!({
				"id": tag.id,
				"name": tag.name,
				"active": tag.active,
			})
		})
		.collect::<Vec<_>>();

	Ok(HttpResponse::Ok().json(result))
}


/// Get tag by name.
#[actix_web::get("/tag_by_name/{name}")]
async fn tag_by_name(db_pool: Data<PgPool>, path: web::Path<(String,)>) -> Result<HttpResponse, ServerError> {
	let name = path.into_inner().0;
	let tag = database::get_tag_by_name(&**db_pool, &name).await?;

	if let Some(tag) = tag {
		Ok(HttpResponse::Ok().json(tag))
	} else {
		Ok(HttpResponse::NotFound().finish())
	}
}


/// Get tag mappings.
#[actix_web::get("/tag_mappings")]
async fn get_tag_mappings(tag_mappings: Data<TagMappings>) -> Result<HttpResponse, ServerError> {
	Ok(HttpResponse::Ok().json(tag_mappings.as_ref()))
}


#[derive(Deserialize)]
struct AddRemoveTagQuery {
	name: String,
	user: i64,
}

/// Add a tag to the database.
#[actix_web::post("/add_tag")]
async fn add_tag(db_pool: Data<PgPool>, data: web::Json<AddRemoveTagQuery>) -> Result<HttpResponse, ServerError> {
	match database::add_tag(&db_pool, &data.name, data.user).await? {
		Ok(_) => Ok(HttpResponse::Ok().finish()),
		Err(_) => Ok(HttpResponse::Conflict().finish()),
	}
}

/// Remove a tag from the database.
#[actix_web::post("/remove_tag")]
async fn remove_tag(db_pool: Data<PgPool>, data: web::Json<AddRemoveTagQuery>) -> Result<HttpResponse, ServerError> {
	match database::remove_tag(&db_pool, &data.name, data.user).await? {
		Ok(_) => Ok(HttpResponse::Ok().finish()),
		Err(_) => Ok(HttpResponse::NotFound().finish()),
	}
}

#[derive(Deserialize)]
struct ListImagesQuery {
	min_id: Option<i64>,
	limit: Option<i64>,
}

/// List images in the database.
#[actix_web::get("/list_images")]
async fn list_images(db_pool: Data<PgPool>, query: web::Query<ListImagesQuery>) -> Result<HttpResponse, ServerError> {
	#[derive(Serialize)]
	struct ApiImage {
		id: i64,
		hash: ImageHash,
		tags: Vec<i64>,
		attributes: HashMap<String, Vec<String>>,
		active: bool,
	}

	let min_id = query.min_id.unwrap_or(0);

	let images = database::list_images(&db_pool, min_id, query.limit).await?;
	let result = images
		.into_iter()
		.map(|image| ApiImage {
			id: image.id,
			hash: image.hash,
			tags: image.tags,
			attributes: image.attributes,
			active: image.active,
		})
		.collect::<Vec<_>>();

	Ok(HttpResponse::Ok().json(result))
}


#[derive(Deserialize)]
struct SearchImagesQuery {
	order_by: Option<OrderBy>,
	operator: Option<SearchOperator>,
	limit: Option<i64>,
	select: Vec<SearchSelect>,
}

/// Search images in the database.
#[actix_web::post("/search_images")]
async fn search_images(db_pool: Data<PgPool>, data: web::Json<SearchImagesQuery>) -> Result<HttpResponse, ServerError> {
	let query = data.into_inner();

	let images = database::search_images(&db_pool, query.select, query.limit, query.order_by, query.operator).await?;

	if images.len() > 0 && images[0].len() == 1 {
		let key = images[0].keys().next().unwrap().clone();
		// If there's only one select, return a flat list
		let images: Vec<_> = images.into_iter().map(|image| image.values().next().unwrap().clone()).collect();
		return Ok(HttpResponse::Ok().json(json!({
			key: images,
		})));
	}

	Ok(HttpResponse::Ok().json(json!({
		"images": images,
	})))
}


/// List image IDs in the database.
#[actix_web::get("/list_image_ids")]
async fn list_image_ids(db_pool: Data<PgPool>) -> Result<HttpResponse, ServerError> {
	let images = database::list_image_ids(&db_pool).await?;

	Ok(HttpResponse::Ok().json(images))
}


/// Get image by hash.
#[actix_web::get("/image_by_hash/{hash}")]
async fn image_by_hash(db_pool: Data<PgPool>, path: web::Path<(ImageHash,)>) -> Result<HttpResponse, ServerError> {
	let hash = path.into_inner().0;
	let image = database::get_image_by_hash(&db_pool, hash).await?;

	if let Some(image) = image {
		Ok(HttpResponse::Ok().json(image))
	} else {
		Ok(HttpResponse::NotFound().finish())
	}
}


/// Get image by hash.
#[actix_web::get("/image_by_id/{id}")]
async fn image_by_id(db_pool: Data<PgPool>, path: web::Path<(i64,)>) -> Result<HttpResponse, ServerError> {
	let image_id = path.into_inner().0;
	let image = database::get_image_by_id(&db_pool, image_id).await?;

	if let Some(image) = image {
		Ok(HttpResponse::Ok().json(image))
	} else {
		Ok(HttpResponse::NotFound().finish())
	}
}

#[derive(Deserialize)]
struct AddRemoveImageQuery {
	hash: ImageHash,
	user: i64,
}

/// Add an image to the database.
#[actix_web::post("/add_image")]
async fn add_image(db_pool: Data<PgPool>, data: web::Json<AddRemoveImageQuery>) -> Result<HttpResponse, ServerError> {
	let hash_str = data.hash.to_string();
	let image_path = Path::new(IMAGE_DIR).join(&hash_str[0..2]).join(&hash_str[2..4]).join(&hash_str);

	// Make sure the image exists on disk and has the correct hash
	let file = match tokio::fs::File::open(&image_path).await {
		Ok(file) => file,
		// Handle not found errors
		Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
			log::warn!("Image not found: {:?}", image_path);
			return Ok(HttpResponse::NotFound().finish());
		},
		Err(err) => {
			log::warn!("Failed to read file: {}", err);
			return Ok(HttpResponse::InternalServerError().finish());
		},
	};

	let file_hash = match hash_async_reader(file).await {
		Ok(file_hash) => file_hash,
		Err(err) => {
			log::warn!("Failed to hash file: {}", err);
			return Ok(HttpResponse::InternalServerError().finish());
		},
	};

	if file_hash != data.hash {
		log::warn!("Image hash mismatch on file: {}", image_path.display());
		return Ok(HttpResponse::InternalServerError().finish());
	}

	if database::add_image(&db_pool, data.hash, data.user).await?.is_err() {
		return Ok(HttpResponse::Conflict().finish());
	}

	Ok(HttpResponse::Ok().finish())
}

/// Remove an image from the database.
#[actix_web::post("/remove_image")]
async fn remove_image(db_pool: Data<PgPool>, data: web::Json<AddRemoveImageQuery>) -> Result<HttpResponse, ServerError> {
	if database::remove_image(&db_pool, data.hash, data.user).await?.is_err() {
		return Ok(HttpResponse::NotFound().finish());
	}

	Ok(HttpResponse::Ok().finish())
}

#[derive(Deserialize)]
struct EditImageAttributeQuery {
	hash: ImageHash,
	key: String,
	value: String,
	user: i64,
	singular: bool,
}

/// Edit an attribute of an image.
#[actix_web::post("/add_image_attribute")]
async fn add_image_attribute(db_pool: Data<PgPool>, data: web::Json<EditImageAttributeQuery>) -> Result<HttpResponse, ServerError> {
	match database::add_image_attribute(&db_pool, data.hash, &data.key, &data.value, data.user, data.singular).await {
		Ok(_) => Ok(HttpResponse::Ok().finish()),
		Err(ApiError::DuplicateAttribute) => Ok(HttpResponse::Conflict().finish()),
		Err(ApiError::ImageDoesNotExist) => Ok(HttpResponse::NotFound().finish()),
		Err(ApiError::ImageInactive) => Ok(HttpResponse::NotFound().finish()),
		Err(ApiError::InternalSqlError(err)) => Err(err.into()),
		Err(ApiError::TagDoesNotExist) => panic!("Not expected"),
	}
}

#[derive(Deserialize)]
struct RemoveImageAttributeQuery {
	hash: ImageHash,
	key: String,
	value: String,
	user: i64,
}

/// Remove an attribute from an image.
#[actix_web::post("/remove_image_attribute")]
async fn remove_image_attribute(db_pool: Data<PgPool>, data: web::Json<RemoveImageAttributeQuery>) -> Result<HttpResponse, ServerError> {
	match database::remove_image_attribute(&db_pool, data.hash, &data.key, &data.value, data.user).await? {
		Ok(_) => Ok(HttpResponse::Ok().finish()),
		Err(_) => Ok(HttpResponse::NotFound().finish()),
	}
}


#[derive(Deserialize)]
struct CaptionImageQuery {
	hash: ImageHash,
	caption: String,
	user: i64,
}

/// Add a caption to an image, or update it if it already exists.
#[actix_web::post("/caption_image")]
async fn caption_image(db_pool: Data<PgPool>, data: web::Json<CaptionImageQuery>) -> Result<HttpResponse, ServerError> {
	match database::edit_image_caption(&db_pool, data.hash, &data.caption, data.user).await? {
		Ok(_) => Ok(HttpResponse::Ok().finish()),
		Err(_) => Ok(HttpResponse::NotFound().finish()),
	}
}


#[derive(Deserialize)]
struct AddRemoveImageTagQuery {
	hash: ImageHash,
	tag: String,
	user: i64,
}

/// Add a tag to an image.
#[actix_web::post("/tag_image")]
async fn tag_image(db_pool: Data<PgPool>, data: web::Json<AddRemoveImageTagQuery>) -> Result<HttpResponse, ServerError> {
	match database::tag_image(&db_pool, data.hash, &data.tag, data.user).await? {
		Ok(_) => Ok(HttpResponse::Ok().finish()),
		Err(_) => Ok(HttpResponse::Conflict().finish()),
	}
}

/// Remove a tag from an image.
#[actix_web::post("/untag_image")]
async fn untag_image(db_pool: Data<PgPool>, data: web::Json<AddRemoveImageTagQuery>) -> Result<HttpResponse, ServerError> {
	match database::untag_image(&db_pool, data.hash, &data.tag, data.user).await? {
		Ok(_) => Ok(HttpResponse::Ok().finish()),
		Err(_) => Ok(HttpResponse::NotFound().finish()),
	}
}


#[derive(Deserialize)]
struct GetImageQuery {
	size: Option<u32>,
}


/// Get an image.
#[actix_web::get("/images/{hash}")]
async fn get_image(req: HttpRequest, path: web::Path<(ImageHash,)>, query: web::Query<GetImageQuery>) -> Result<HttpResponse, ServerError> {
	let hash = path.into_inner().0;
	let hash_str = hash.to_string();
	let image_path = Path::new(IMAGE_DIR).join(&hash_str[0..2]).join(&hash_str[2..4]).join(&hash_str);

	log::info!("Getting image: {:?}", image_path);

	if !image_path.exists() {
		return Ok(HttpResponse::NotFound().finish());
	}

	if let Some(size) = query.size {
		if size > 4096 {
			return Ok(HttpResponse::BadRequest().finish());
		}

		let resized_image = resize_image(&image_path, size)?;
		return Ok(HttpResponse::Ok().append_header(("Content-Type", "image/webp")).body(resized_image));
	}

	// Read the first 32 bytes so we can guess the type
	let mut file = tokio::fs::File::open(&image_path).await?;
	let mut buffer = [0; 32];
	file.read_exact(&mut buffer).await?;

	// Guess the image type
	let format = image::guess_format(&buffer).ok().map(|f| f.to_mime_type());
	let mime: mime::Mime = format.unwrap_or_else(|| "application/octet-stream").parse().unwrap();

	let file = NamedFile::open(image_path)?.set_content_type(mime);

	Ok(file.into_response(&req))
}

fn resize_image(path: &Path, max_side: u32) -> Result<Vec<u8>, anyhow::Error> {
	let img = ImageReader::open(path)?
		.with_guessed_format()
		.context("Error guessing image format")?
		.decode()
		.context("Error decoding image")?;

	let img = img.resize(max_side, max_side, imageops::FilterType::Lanczos3);

	assert!(img.width() <= max_side && img.height() <= max_side && (img.width() == max_side || img.height() == max_side));

	let mut buffer = Vec::new();
	let encoder = image::codecs::webp::WebPEncoder::new_lossless(&mut buffer);
	img.write_with_encoder(encoder).context("Error encoding image")?;

	Ok(buffer)
}


/// Get an image by id.
#[actix_web::get("/images_by_id/{id}")]
async fn get_image_by_id(db_pool: Data<PgPool>, path: web::Path<(i64,)>) -> Result<NamedFile, ServerError> {
	let image_id = path.into_inner().0;
	let image_hash = match database::get_image_hash_from_id(&db_pool, image_id).await? {
		Some(image_hash) => image_hash,
		None => ImageHash::from_bytes([0; 32]), // A bit of a hack, but this should get it to return a 404
	};
	let hash_str = image_hash.to_string();
	let image_path = Path::new(IMAGE_DIR).join(&hash_str[0..2]).join(&hash_str[2..4]).join(&hash_str);

	// Read the first 32 bytes so we can guess the type
	let mut file = tokio::fs::File::open(&image_path).await?;
	let mut buffer = [0; 32];
	file.read_exact(&mut buffer).await?;

	// Guess the image type
	let format = image::guess_format(&buffer).ok().map(|f| f.to_mime_type());
	let mime: mime::Mime = format.unwrap_or_else(|| "application/octet-stream").parse().unwrap();

	let file = NamedFile::open(image_path)?.set_content_type(mime);

	Ok(file)
}


#[derive(Deserialize)]
struct ListLogsQuery {
	image_hash: Option<ImageHash>,
	action: Option<String>,
	min_id: i64,
	limit: Option<i64>,
}


/// List logs.
#[actix_web::get("/logs")]
async fn list_logs(db_pool: Data<PgPool>, query: web::Query<ListLogsQuery>) -> Result<HttpResponse, ServerError> {
	let query = query.into_inner();

	let logs = database::list_logs(&db_pool, query.image_hash, query.action, query.min_id, query.limit).await?;

	Ok(HttpResponse::Ok().json(logs))
}


/// List images with blame
#[actix_web::get("/list_images_with_blame")]
async fn list_images_with_blame(db_pool: Data<PgPool>, query: web::Query<ListImagesQuery>) -> Result<HttpResponse, ServerError> {
	let query = query.into_inner();

	let images = database::list_images_with_blame(&db_pool, query.min_id.unwrap_or(0), query.limit).await?;

	Ok(HttpResponse::Ok().json(images))
}


#[derive(Deserialize)]
struct SetImageEmbeddingQuery {
	hash: ImageHash,
	name: String,
	embedding: String,
	user: i64,
}


/// Set an image embedding on an image.
#[actix_web::post("/set_image_embedding")]
async fn set_image_embedding(db_pool: Data<PgPool>, data: web::Json<SetImageEmbeddingQuery>) -> Result<HttpResponse, ServerError> {
	// Decode embedding as hex string
	let embedding = match hex::decode(&data.embedding) {
		Ok(embedding) => embedding,
		Err(_) => return Ok(HttpResponse::BadRequest().finish()),
	};

	match database::set_image_embedding(&db_pool, data.hash, &data.name, &embedding).await? {
		Ok(_) => Ok(HttpResponse::Ok().finish()),
		Err(_) => Ok(HttpResponse::NotFound().finish()),
	}
}


#[derive(Deserialize)]
struct ListImageEmbeddingsQuery {
	name: String,
	min_id: Option<i64>,
	limit: Option<i64>,
}


/// List image embeddings.
#[actix_web::get("/list_image_embeddings")]
async fn list_image_embeddings(db_pool: Data<PgPool>, query: web::Query<ListImageEmbeddingsQuery>) -> Result<HttpResponse, ServerError> {
	let query = query.into_inner();

	let stream = async_stream::stream! {
		let mut embeddings = database::list_image_embeddings(&db_pool, &query.name, query.min_id.unwrap_or(0), query.limit);

		while let Some(row) = embeddings.next().await {
			let (image_id, embedding) = row?;
			let image_id = image_id.to_be_bytes();
			let mut bytes = BytesMut::from(image_id.as_ref());
			bytes.extend_from_slice(&embedding);

			let result: Result<Bytes, sqlx::Error> = Ok(bytes.freeze());

			yield result;
		}
	};

	Ok(HttpResponse::Ok().append_header(("Content-Type", "application/octet-stream")).streaming(stream))
}


#[derive(Debug, MultipartForm)]
struct UploadImageForm {
	#[multipart(rename = "file")]
	files: Vec<TempFile>,
	user: actix_multipart::form::text::Text<i64>,
}


#[actix_web::post("/upload_image")]
async fn upload_image(db_pool: Data<PgPool>, MultipartForm(form): MultipartForm<UploadImageForm>) -> Result<HttpResponse, ServerError> {
	if form.files.len() != 1 {
		return Ok(HttpResponse::BadRequest().finish());
	}

	// Hash the file
	let file = match form.files.into_iter().next() {
		Some(file) => file,
		None => return Ok(HttpResponse::BadRequest().finish()),
	};
	let async_file = match file.file.reopen() {
		Ok(std_file) => tokio::fs::File::from_std(std_file),
		Err(err) => {
			log::warn!("Failed to reopen temporary file: {}", err);
			return Ok(HttpResponse::InternalServerError().finish());
		},
	};

	let file_hash = match hash_async_reader(async_file).await {
		Ok(file_hash) => file_hash,
		Err(err) => {
			log::warn!("Failed to hash file: {}", err);
			return Ok(HttpResponse::InternalServerError().finish());
		},
	};

	// Format the (potential) image pathes
	let hash_str = file_hash.to_string();
	let image_path = Path::new(IMAGE_DIR).join(&hash_str[0..2]).join(&hash_str[2..4]).join(&hash_str);
	let upload_path = Path::new(UPLOAD_DIR).join(&hash_str);
	let upload_path_tmp = Path::new(UPLOAD_DIR).join(format!("{}.tmp", &hash_str));

	// Make sure the image doesn't already exist
	if upload_path.exists() || image_path.exists() {
		return Ok(HttpResponse::Conflict().reason("Image already exists").finish());
	}

	// Create the directory if it doesn't exist
	if let Err(err) = tokio::fs::create_dir_all(image_path.parent().unwrap()).await {
		log::warn!("Failed to create directory: {}", err);
		return Ok(HttpResponse::InternalServerError().finish());
	}

	if let Err(err) = tokio::fs::create_dir_all(upload_path.parent().unwrap()).await {
		log::warn!("Failed to create directory: {}", err);
		return Ok(HttpResponse::InternalServerError().finish());
	}

	// Copy the file to the upload directory
	if let Err(err) = tokio::fs::copy(&file.file.path(), &upload_path_tmp).await {
		log::warn!("Failed to copy file: {}", err);
		return Ok(HttpResponse::InternalServerError().finish());
	}

	// Rename the file to the image directory, atomically
	// NOTE: This may overwrite an existing file due to race conditions, but that's fine
	if let Err(err) = tokio::fs::rename(&upload_path_tmp, &upload_path).await {
		log::warn!("Failed to rename file: {}", err);
		return Ok(HttpResponse::InternalServerError().finish());
	}

	// Symlink the file to the image directory
	let relative_path = match pathdiff::diff_paths(&upload_path, image_path.parent().unwrap()) {
		Some(relative_path) => relative_path,
		None => {
			log::warn!("Failed to get relative path between {:?} and {:?}", upload_path, image_path);
			return Ok(HttpResponse::InternalServerError().finish());
		},
	};

	if let Err(err) = tokio::fs::symlink(relative_path, &image_path).await {
		log::warn!("Failed to create symlink: {}", err);
		return Ok(HttpResponse::InternalServerError().finish());
	}

	// Set file permissions to 644
	if let Err(err) = tokio::fs::set_permissions(&image_path, std::fs::Permissions::from_mode(0o644)).await {
		log::warn!("Failed to set file permissions: {}", err);
		return Ok(HttpResponse::InternalServerError().finish());
	}

	// Add the image to the database
	if database::add_image(&db_pool, file_hash, *form.user).await?.is_err() {
		return Ok(HttpResponse::Conflict().reason("Database conflict").finish());
	}

	Ok(HttpResponse::Ok().finish())
}


async fn hash_async_reader<R: tokio::io::AsyncRead + Unpin>(mut reader: R) -> Result<ImageHash, std::io::Error> {
	let mut hasher = Sha256::new();
	let mut buffer = [0; 1024 * 1024];

	loop {
		match reader.read(&mut buffer).await {
			Ok(bytes_read) if bytes_read == 0 => break,
			Ok(bytes_read) => hasher.update(&buffer[0..bytes_read]),
			Err(err) => return Err(err),
		};
	}

	let hash = hasher.finalize();

	Ok(ImageHash::from_bytes(hash.into()))
}