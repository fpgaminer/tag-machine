#[derive(Debug)]
pub enum ApiError {
	ImageDoesNotExist,
	ImageInactive,   // The requested action requires an active image, and the image exists, but is not active
	DuplicateAttribute,  // Attempted to add an attribute that already exists (for a specific key-value pair)
	InternalSqlError(sqlx::Error),
	TagDoesNotExist,
}

impl From<sqlx::Error> for ApiError {
	fn from(err: sqlx::Error) -> ApiError {
		ApiError::InternalSqlError(err)
	}
}