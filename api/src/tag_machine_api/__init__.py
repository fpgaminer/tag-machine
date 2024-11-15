#!/usr/bin/env python3
from typing import Generator
import requests
from pydantic import BaseModel
import logging


API_URL = 'http://localhost:1420'


class DBImage(BaseModel):
	id: int
	hash: str
	active: bool
	tags: set[str]
	attributes: dict[str, set[str]]
	tags_blame: dict[str, int] | None   # tag -> user_id
	caption: str | None

	def add_tag(self, api: 'TagMachineAPI', tag: str):
		api.tag_image(bytes.fromhex(self.hash), tag)
		self.tags.add(tag)
	
	def remove_tag(self, api: 'TagMachineAPI', tag: str):
		api.untag_image(bytes.fromhex(self.hash), tag)
		self.tags.remove(tag)
	
	def add_attribute(self, api: 'TagMachineAPI', key: str, value: str, singular: bool):
		api.add_image_attribute(bytes.fromhex(self.hash), key, value, singular)
		if key not in self.attributes:
			self.attributes[key] = set()
		
		if singular:
			self.attributes[key] = {value}
		else:
			self.attributes[key].add(value)
	
	def remove_attribute(self, api: 'TagMachineAPI', key: str, value: str):
		api.remove_image_attribute(bytes.fromhex(self.hash), key, value)
		if key in self.attributes:
			self.attributes[key].remove(value)


class DBTag(BaseModel):
	id: int
	name: str
	active: bool


class DBLog(BaseModel):
	id: int
	timestamp: int
	user_id: int
	action: str
	image_hash: str | None
	tag: str | None
	attribute_key: str | None
	attribute_value: str | None


class TagMachineAPI:
	def __init__(self, username: str, login_key: bytes | str, url: str = API_URL):
		if isinstance(login_key, bytes):
			login_key = login_key.hex()

		self.session = requests.Session()
		self.url = url

		# Login
		response = requests.post(self.url + '/api/login', json={'username': username, 'login_key': login_key})
		response.raise_for_status()
		user_token = response.json()
		assert isinstance(user_token, str)
		self.user_token = user_token

		# Set default headers
		self.session.headers['Authorization'] = f'Bearer {self.user_token}'
	
	def get_image_by_hash(self, image_hash: bytes) -> DBImage:
		"""
		Get an image's metadata by its hash.
		"""
		r = self.session.get(f'{self.url}/api/image_by_hash/{image_hash.hex()}')
		r.raise_for_status()
		metadata = r.json()
		return DBImage(tags_blame=None, **metadata)
	
	def get_image_by_id(self, image_id: int) -> DBImage:
		"""
		Get an image's metadata by its id.
		"""
		r = self.session.get(f'{self.url}/api/image_by_id/{image_id}')
		r.raise_for_status()
		metadata = r.json()
		return DBImage(tags_blame=None, **metadata)
	
	def read_image_by_hash(self, image_hash: bytes) -> bytes:
		"""
		Read an image by its hash.
		"""
		r = self.session.get(f'{self.url}/api/images/{image_hash.hex()}')
		r.raise_for_status()
		return r.content

	def read_image_by_id(self, image_id: int) -> bytes:
		"""
		Read an image by its id.
		"""
		r = self.session.get(f'{self.url}/api/images_by_id/{image_id}')
		r.raise_for_status()
		return r.content

	
	def tag_image(self, image_hash: bytes, tag: str):
		"""
		Add a tag to an image.
		"""
		data = {
			'hash': image_hash.hex(),
			'tag': tag,
		}
		r = self.session.post(f'{self.url}/api/tag_image', json=data)
		r.raise_for_status()
	
	def untag_image(self, image_hash: bytes, tag: str):
		"""
		Remove a tag from an image.
		"""
		data = {
			'hash': image_hash.hex(),
			'tag': tag,
		}
		r = self.session.post(f'{self.url}/api/untag_image', json=data)
		r.raise_for_status()
	
	def add_image_attribute(self, image_hash: bytes, key: str, value: str, singular: bool) -> bool:
		"""
		Add an attribute to an image. Returns False if the attribute already exists.
		"""
		data = {
			'hash': image_hash.hex(),
			'key': key,
			'value': value,
			'singular': singular,
		}
		r = self.session.post(f'{self.url}/api/add_image_attribute', json=data)
		if r.status_code == 409:
			return False
		r.raise_for_status()
		return True

	def remove_image_attribute(self, image_hash: bytes, key: str, value: str):
		"""
		Remove an attribute from an image.
		"""
		data = {
			'hash': image_hash.hex(),
			'key': key,
			'value': value,
		}
		r = self.session.post(f'{self.url}/api/remove_image_attribute', json=data)
		r.raise_for_status()
	
	def fetch_logs(self, image_hash: bytes | None = None, action: str | None = None) -> list[DBLog]:
		params = {
			'min_id': 0,
			'limit': 1000000,
			'image_hash': image_hash.hex() if image_hash is not None else None,
			'action': action,
		}

		logs = []

		while True:
			response = self.session.get(f'{self.url}/api/logs', params=params)
			response.raise_for_status()
			response_json = response.json()
			new_logs = [DBLog(**log) for log in response_json]
			if len(new_logs) == 0:
				break

			logs.extend(new_logs)
			params['min_id'] = new_logs[-1].id + 1
	
		return logs
	
	def search(self, operator: dict, order_by: str, select: list[str], limit: int | None) -> list | dict:
		"""
		Search images in the database.
		"""
		params = {
			'order_by': order_by,
			'operator': operator,
			'limit': limit,
			'select': select,
		}
		r = self.session.post(f'{self.url}/api/search_images', json=params)
		r.raise_for_status()
		return r.json()
	
	def add_image(self, image_hash: bytes) -> bool:
		"""
		Add an image to the database. Returns False if the image already exists.
		"""
		data = {
			'hash': image_hash.hex(),
		}
		r = self.session.post(f'{self.url}/api/add_image', json=data)
		if r.status_code == 409:
			return False
		r.raise_for_status()
		return True


class DatabaseData:
	tags: list[DBTag]
	tag_to_id: dict[str, int]
	id_to_tag: dict[int, str]

	images: dict[int, DBImage]
	images_sorted_by_hash: list[DBImage]
	images_sorted_by_id: list[DBImage]

	fetch_limit: int = 1000000

	def __init__(self, username: str, login_key: bytes):
		self.tags = []
		self.tag_to_id = {}
		self.id_to_tag = {}

		self.images = {}
		self.images_sorted_by_hash = []
		self.images_sorted_by_id = []

		# Login
		response = requests.post(API_URL + '/api/login', json={'username': username, 'login_key': login_key.hex()})
		response.raise_for_status()
		user_token = response.json()
		assert isinstance(user_token, str)
		self.user_token = user_token
	
	def fetch_tags(self):
		response = requests.get(API_URL + '/api/tags', headers={'Authorization': f'Bearer {self.user_token}'})
		response.raise_for_status()
		tags = response.json()
		self.tags = [DBTag(**tag) for tag in tags]
		self.tag_to_id = {tag.name: tag.id for tag in self.tags}
		self.id_to_tag = {tag.id: tag.name for tag in self.tags}
	
	def fetch_images(self, with_blame: bool = False):
		while True:
			if with_blame:
				response = requests.get(API_URL + '/api/list_images_with_blame', params={'min_id': max(self.images.keys()) + 1 if len(self.images) > 0 else 0, 'limit': self.fetch_limit}, headers={'Authorization': f'Bearer {self.user_token}'})
			else:
				response = requests.get(API_URL + '/api/list_images', params={'min_id': max(self.images.keys()) + 1 if len(self.images) > 0 else 0, 'limit': self.fetch_limit}, headers={'Authorization': f'Bearer {self.user_token}'})
			response.raise_for_status()

			new_images = response.json()
			if len(new_images) == 0:
				break

			for image in new_images:
				if with_blame:
					image['tags_blame'] = {self.id_to_tag[int(tag_id)]: user_id for tag_id, user_id in image['tags_blame'].items()}
					image['tags'] = set(image['tags_blame'].keys())
				else:
					image['tags_blame'] = None
					image['tags'] = [self.id_to_tag[tag_id] for tag_id in image['tags']]
				
				image_obj = DBImage(**image)
				self.images[image_obj.id] = image_obj
		
		logging.info('Sorting images...')
		self.images_sorted_by_hash = sorted(self.images.values(), key=lambda image: image.hash)
		self.images_sorted_by_id = sorted(self.images.values(), key=lambda image: image.id)
	
	def fetch_image_batches(self, with_blame: bool = False, batch_size: int = 2**16) -> Generator[DBImage, None, None]:
		while True:
			if with_blame:
				response = requests.get(API_URL + '/api/list_images_with_blame', params={'min_id': max(self.images.keys()) + 1 if len(self.images) > 0 else 0, 'limit': batch_size}, headers={'Authorization': f'Bearer {self.user_token}'})
			else:
				response = requests.get(API_URL + '/api/list_images', params={'min_id': max(self.images.keys()) + 1 if len(self.images) > 0 else 0, 'limit': batch_size}, headers={'Authorization': f'Bearer {self.user_token}'})
			response.raise_for_status()

			new_images = response.json()
			if len(new_images) == 0:
				break

			for image in new_images:
				if with_blame:
					image['tags_blame'] = {self.id_to_tag[int(tag_id)]: user_id for tag_id, user_id in image['tags_blame'].items()}
					image['tags'] = set(image['tags_blame'].keys())
				else:
					image['tags_blame'] = None
					image['tags'] = [self.id_to_tag[tag_id] for tag_id in image['tags']]
				
				image_obj = DBImage(**image)
				self.images[image_obj.id] = image_obj
				yield image_obj
		
		logging.info('Sorting images...')
		self.images_sorted_by_hash = sorted(self.images.values(), key=lambda image: image.hash)
		self.images_sorted_by_id = sorted(self.images.values(), key=lambda image: image.id)
	
	def search_images_batched(self, operator: dict, batch_size: int = 2**16) -> Generator[DBImage, None, None]:
		min_id = 0

		while True:
			op = {
				'and': [
					operator,
					{'minid': min_id},
				]
			}

			params = {
				'order_by': 'id',
				'operator': op,
				'limit': batch_size,
				'select': ['id','hash','active','tags','attributes','caption'],
			}

			response = requests.post(API_URL + '/api/search_images', json=params, headers={'Authorization': f'Bearer {self.user_token}'})
			response.raise_for_status()

			new_images = response.json()['images']
			if len(new_images) == 0:
				break

			for image in new_images:
				image['tags'] = [self.id_to_tag[tag_id] for tag_id in image['tags']]
				image['tags_blame'] = None

				image_obj = DBImage(**image)
				self.images[image_obj.id] = image_obj
				yield image_obj
				min_id = max(min_id, image_obj.id + 1)
			
		logging.info('Sorting images...')
		self.images_sorted_by_hash = sorted(self.images.values(), key=lambda image: image.hash)
		self.images_sorted_by_id = sorted(self.images.values(), key=lambda image: image.id)