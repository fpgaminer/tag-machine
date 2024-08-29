use rand::prelude::Distribution;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::pin::Pin;
use actix_web::{
	dev::Payload,
	error::{ErrorInternalServerError, ErrorUnauthorized},
	web, Error, FromRequest, HttpRequest,
};
use futures::Future;
use sqlx::PgPool;

use crate::database::get_user_id_from_token;


#[derive(Clone, Copy, Debug)]
pub struct LoginKey(pub [u8; 32]);

impl LoginKey {
	pub fn from_bytes(bytes: [u8; 32]) -> Self {
		LoginKey(bytes)
	}

	pub fn hash(&self) -> LoginKey {
		let mut hasher = Sha256::new();
		hasher.update(&self.0);

		let hash = hasher.finalize();

		LoginKey::from_bytes(hash.into())
	}
}

impl ToString for LoginKey {
	fn to_string(&self) -> String {
		hex::encode(self.0)
	}
}

impl Distribution<LoginKey> for rand::distributions::Standard {
	fn sample<R: rand::Rng + ?Sized>(&self, rng: &mut R) -> LoginKey {
		LoginKey(rng.gen())
	}
}

impl Serialize for LoginKey {
	fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
	where
		S: serde::Serializer,
	{
		serializer.serialize_str(&hex::encode(self.0))
	}
}

impl<'de> Deserialize<'de> for LoginKey {
	fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
	where
		D: serde::Deserializer<'de>,
	{
		let s = String::deserialize(deserializer)?;
		let bytes = hex::decode(s).map_err(serde::de::Error::custom)?;
		let hash = bytes.try_into().map_err(|_| serde::de::Error::custom("Invalid hash length"))?;
		Ok(LoginKey(hash))
	}
}

impl ::std::cmp::PartialEq for LoginKey {
	fn eq(&self, other: &Self) -> bool {
		use ::subtle::ConstantTimeEq;

		self.0.ct_eq(&other.0).into()
	}
}



#[derive(Clone, Copy, Debug)]
pub struct UserToken(pub [u8; 32]);

impl UserToken {
	pub fn from_bytes(bytes: [u8; 32]) -> Self {
		UserToken(bytes)
	}
}

impl ToString for UserToken {
	fn to_string(&self) -> String {
		hex::encode(self.0)
	}
}

impl Distribution<UserToken> for rand::distributions::Standard {
	fn sample<R: rand::Rng + ?Sized>(&self, rng: &mut R) -> UserToken {
		UserToken(rng.gen())
	}
}

impl Serialize for UserToken {
	fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
	where
		S: serde::Serializer,
	{
		serializer.serialize_str(&hex::encode(self.0))
	}
}

impl<'de> Deserialize<'de> for UserToken {
	fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
	where
		D: serde::Deserializer<'de>,
	{
		let s = String::deserialize(deserializer)?;
		let bytes = hex::decode(s).map_err(serde::de::Error::custom)?;
		let hash = bytes.try_into().map_err(|_| serde::de::Error::custom("Invalid hash length"))?;
		Ok(UserToken(hash))
	}
}




pub struct AuthenticatedUser {
	pub id: i64,
	pub token: UserToken,
	pub is_admin: bool,
}

impl FromRequest for AuthenticatedUser {
	type Error = Error;
	type Future = Pin<Box<dyn Future<Output = Result<Self, Self::Error>>>>;

	fn from_request(req: &HttpRequest, _: &mut Payload) -> Self::Future {
		let req = req.clone();
		Box::pin(async move {
			let db_pool = req
				.app_data::<PgPool>()
				.or_else(|| req.app_data::<web::Data<PgPool>>().map(|d| d.as_ref()))
				.expect("Missing PgPool");
			
			let token = req
				.headers()
				.get("Authorization")
				.and_then(|auth| auth.to_str().ok())
				// Skip "Bearer"
				.and_then(|auth| auth.split(' ').nth(1))
				// Decode as hex
				.and_then(|auth| {
					let mut token = [0u8; 32];
					hex::decode_to_slice(auth, &mut token).ok()?;
					Some(UserToken::from_bytes(token))
				})
				.ok_or_else(|| ErrorUnauthorized("Invalid Authorization Header"))?;

			let (user_id, is_admin) = get_user_id_from_token(&db_pool, &token)
				.await
				.map_err(ErrorInternalServerError)?
				.ok_or_else(|| ErrorUnauthorized("Invalid Token"))?;

			Ok(AuthenticatedUser {
				id: user_id,
				token,
				is_admin,
			})
		})
	}
}