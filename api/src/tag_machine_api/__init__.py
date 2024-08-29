#!/usr/bin/env python3
from typing import Generator
from PIL import Image
from io import BytesIO
import requests
from pydantic import BaseModel
import logging
import struct
from collections import defaultdict


API_URL = 'http://localhost:1420'


class DBImage(BaseModel):
	id: int
	hash: str
	active: bool
	tags: set[str]
	attributes: dict[str, list[str]]
	tags_blame: dict[str, int] | None   # tag -> user_id
	caption: str | None

	def tag(self, name: str, user_id: int):
		data = {
			'hash': self.hash,
			'tag': name,
			'user': user_id,
		}
		r = requests.post(f'{API_URL}/api/tag_image', json=data)
		r.raise_for_status()
		self.tags.add(name)
	
	def untag(self, name: str, user_id: int):
		data = {
			'hash': self.hash,
			'tag': name,
			'user': user_id,
		}
		r = requests.post(f'{API_URL}/api/untag_image', json=data)
		r.raise_for_status()
		self.tags.remove(name)
	
	def read_image(self):
		r = requests.get(f'{API_URL}/images/{self.hash}')
		r.raise_for_status()
		return Image.open(BytesIO(r.content))
	
	def edit_attribute(self, name: str, value: str, user_id: int):
		data = {
			'hash': self.hash,
			'key': name,
			'value': value,
			'user': user_id,
		}
		r = requests.post(f'{API_URL}/api/edit_image_attribute', json=data)
		r.raise_for_status()
		self.attributes[name] = value
	
	def remove_attribute(self, name: str, user_id: int):
		data = {
			'hash': self.hash,
			'key': name,
			'user': user_id,
		}
		r = requests.post(f'{API_URL}/api/remove_image_attribute', json=data)
		r.raise_for_status()
		del self.attributes[name]


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
	
	def fetch_logs(self, image_hash: str | None = None, action: str | None = None) -> list[DBLog]:
		params = {
			'min_id': 0,
			'limit': 1000000,
			'image_hash': image_hash,
			'action': action,
		}

		logs = []

		while True:
			response = requests.get(API_URL + '/api/logs', params=params, headers={'Authorization': f'Bearer {self.user_token}'})
			response.raise_for_status()
			response_json = response.json()
			new_logs = [DBLog(**log) for log in response_json]
			if len(new_logs) == 0:
				break

			logs.extend(new_logs)
			params['min_id'] = new_logs[-1].id + 1
	
		return logs


def read_image_by_id(image_id: int, session: requests.Session | None = None) -> Image.Image:
	session = session if session is not None else requests.Session()

	r = session.get(f'{API_URL}/images_by_id/{image_id}')
	r.raise_for_status()
	return Image.open(BytesIO(r.content))


def read_image_by_hash(image_hash: str, session: requests.Session | None = None) -> Image.Image:
	session = session if session is not None else requests.Session()

	r = session.get(f'{API_URL}/images/{image_hash}')
	r.raise_for_status()
	return Image.open(BytesIO(r.content))