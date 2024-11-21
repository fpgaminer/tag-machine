#!/usr/bin/env python3
from typing import Generator
import requests
from pydantic import BaseModel
import logging
import numpy as np
import dataclasses

from tag_machine_api.TagStormDb.AttributeWithBlame import AttributeWithBlame
from tag_machine_api.TagStormDb.HashResponse import HashResponse
from tag_machine_api.TagStormDb.IDResponse import IDResponse
from tag_machine_api.TagStormDb.ImageResponse import ImageResponse
from tag_machine_api.TagStormDb.ResponseType import ResponseType
from tag_machine_api.TagStormDb.SearchResultResponse import SearchResultResponse
from tag_machine_api.TagStormDb.Image import Image as ApiImage
from tag_machine_api.TagStormDb.TagWithBlame import TagWithBlame


API_URL = 'http://localhost:1420'


@dataclasses.dataclass(frozen=True)
class DBImage:
	id: int
	hash: str
	active: bool
	tags: dict[str, int]  # tag -> user_id
	attributes: dict[str, dict[str, int]]  # key -> {value -> user_id}


@dataclasses.dataclass(frozen=True)
class SearchResultImage:
	id: int | None
	hash: bytes | None
	tags: dict[str, int] | None
	attributes: dict[str, dict[str, int]] | None


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
	def __init__(self, token: bytes | str, url: str = API_URL):
		if isinstance(token, bytes):
			token = token.hex()

		self.session = requests.Session()
		self.url = url

		# Set default headers
		self.session.headers['Authorization'] = f'Bearer {token}'
	
	def get_image_metadata(self, id: bytes | int) -> DBImage:
		"""
		Get an image's metadata.
		"""
		if isinstance(id, bytes):
			id_str = id.hex()
		else:
			id_str = str(id)
		r = self.session.get(f'{self.url}/api/images/{id_str}/metadata')
		r.raise_for_status()
		metadata = r.json()
		return DBImage(**metadata)
	
	def read_image(self, id: bytes | int) -> bytes:
		"""
		Read an image's data.
		"""
		id_str = id.hex() if isinstance(id, bytes) else str(id)
		r = self.session.get(f'{self.url}/api/images/{id_str}')
		r.raise_for_status()
		return r.content
	
	def tag_image(self, id: bytes | int, tag: str | int):
		"""
		Add a tag to an image.
		"""
		id_str = id.hex() if isinstance(id, bytes) else str(id)
		r = self.session.post(f'{self.url}/api/images/{id_str}/tags/{tag}')
		r.raise_for_status()
	
	def untag_image(self, id: bytes | int, tag: str | int):
		"""
		Remove a tag from an image.
		"""
		id_str = id.hex() if isinstance(id, bytes) else str(id)
		r = self.session.delete(f'{self.url}/api/images/{id_str}/tags/{tag}')
		r.raise_for_status()
	
	def add_image_attribute(self, id: bytes | int, key: str | int, value: str, singular: bool) -> bool:
		"""
		Add an attribute to an image. Returns False if the attribute already exists.
		"""
		id_str = id.hex() if isinstance(id, bytes) else str(id)
		singular_str = 'true' if singular else 'false'
		r = self.session.post(f'{self.url}/api/images/{id_str}/attributes/{key}/{value}/{singular_str}')
		if r.status_code == 409:
			return False
		r.raise_for_status()
		return True

	def remove_image_attribute(self, id: bytes | int, key: str | int, value: str):
		"""
		Remove an attribute from an image.
		"""
		id_str = id.hex() if isinstance(id, bytes) else str(id)
		r = self.session.delete(f'{self.url}/api/images/{id_str}/attributes/{key}/{value}')
		r.raise_for_status()
	
	# def fetch_logs(self, image_hash: bytes | None = None, action: str | None = None) -> list[DBLog]:
	# 	params = {
	# 		'min_id': 0,
	# 		'limit': 1000000,
	# 		'image_hash': image_hash.hex() if image_hash is not None else None,
	# 		'action': action,
	# 	}

	# 	logs = []

	# 	while True:
	# 		response = self.session.get(f'{self.url}/api/logs', params=params)
	# 		response.raise_for_status()
	# 		response_json = response.json()
	# 		new_logs = [DBLog(**log) for log in response_json]
	# 		if len(new_logs) == 0:
	# 			break

	# 		logs.extend(new_logs)
	# 		params['min_id'] = new_logs[-1].id + 1
	
	# 	return logs
	
	def search(self, query: str, select: list[str]) -> np.ndarray | list[bytes] | list[SearchResultImage]:
		"""
		Search images in the database.
		"""
		params = {
			'select': ','.join(select),
			'query': query,
		}
		r = self.session.get(f'{self.url}/api/search/images', params=params)
		if r.status_code != 200:
			raise Exception(f'Failed to search images ({r.status_code}): {r.text}')

		result = r.content
		return parse_search_response(SearchResultResponse.GetRootAs(result, 0))
	
	def add_image(self, image_hash: bytes) -> bool:
		"""
		Add an image to the database. Returns False if the image already exists.
		"""
		r = self.session.post(f'{self.url}/api/images/{image_hash.hex()}')
		if r.status_code == 409:
			return False
		r.raise_for_status()
		return True


def parse_search_response(response: SearchResultResponse) -> np.ndarray | list[bytes] | list[SearchResultImage]:
	data = response.Data()
	assert data is not None
	response_type = response.DataType()

	# Don't handle other response types yet
	if response_type == ResponseType.IDResponse:
		result = IDResponse()
		result.Init(data.Bytes, data.Pos)
		result = result.IdsAsNumpy()
		assert isinstance(result, np.ndarray)
		return result
	elif response_type == ResponseType.HashResponse:
		result = HashResponse()
		result.Init(data.Bytes, data.Pos)
		hash_tables = (result.Hashes(i)._tab for i in range(result.HashesLength())) # type: ignore
		hashes = [hash.Bytes[hash.Pos:hash.Pos+32] for hash in hash_tables]
		return hashes
	elif response_type == ResponseType.ImageResponse:
		result = ImageResponse()
		result.Init(data.Bytes, data.Pos)
		images = []
		for i in range(result.ImagesLength()):
			image = result.Images(i)
			assert isinstance(image, ApiImage)
			id = image.Id()
			hash = image.Hash()
			if hash is not None:
				hash = hash._tab
				hash = hash.Bytes[hash.Pos:hash.Pos+32]
			tags: dict[str, int] | None = None
			if not image.TagsIsNone():
				tags = {}
				for i in range(image.TagsLength()):
					tag = image.Tags(i)
					assert isinstance(tag, TagWithBlame)
					k = tag.Tag()
					v = tag.Blame()
					assert isinstance(k, str), f'Expected str, got {type(k)}'
					assert isinstance(v, int), f'Expected int, got {type(v)}'
					tags[k] = v					

			attributes = None
			if not image.AttributesIsNone():
				attributes = {}
				for i in range(image.AttributesLength()):
					attr = image.Attributes(i)
					assert isinstance(attr, AttributeWithBlame)
					key = attr.Key().decode('utf-8')
					value = attr.Value().decode('utf-8')
					blame = attr.Blame()
					if key not in attributes:
						attributes[key] = {}
					attributes[key][value] = blame
			
			images.append(SearchResultImage(id=id, hash=hash, tags=tags, attributes=attributes))
		
		return images
	else:
		raise NotImplementedError(f'Unknown response type: {response_type}')



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