use actix_web::HttpResponse;
use core::fmt::{self, Debug, Display};

/// This error type is needed so we can control how actix reports our internal errors
pub struct ServerError(anyhow::Error);

impl actix_web::error::ResponseError for ServerError {
	fn error_response(&self) -> HttpResponse {
		HttpResponse::InternalServerError().body("Internal Server Error")
	}
}

impl<E> From<E> for ServerError
where
	E: Into<anyhow::Error>,
{
	fn from(err: E) -> ServerError {
		ServerError(err.into())
	}
}

impl Debug for ServerError {
	fn fmt(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
		Debug::fmt(&self.0, formatter)
	}
}

impl Display for ServerError {
	fn fmt(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
		Display::fmt(&self.0, formatter)
	}
}
