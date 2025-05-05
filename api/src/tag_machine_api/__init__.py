#!/usr/bin/env python3
from typing import Generator
import requests
from pydantic import BaseModel
import logging
import numpy as np
import dataclasses
from pathlib import Path
from hashlib import sha256
from PIL import Image
import time
from numpy.typing import NDArray
from tag_machine_api.parse import parse_search_response_images


API_URL = 'http://localhost:1420'
TAG_MACHINE_DEST_DIR = Path("/home/night/tag-machine/rust-api/images").absolute()


@dataclasses.dataclass(frozen=True)
class DBImage:
	id: int
	hash: str
	active: bool
	tags: dict[int, int]  # tag -> user_id
	attributes: dict[str, dict[str, int]]  # key -> {value -> user_id}


# @dataclasses.dataclass(frozen=True)
class SearchResultImage:
	id: int | None
	hash: bytes | None
	tags: dict[int, int] | None
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
		r = request_with_retry(self.session, 'GET', f'{self.url}/api/images/{id_str}/metadata', timeout=30)
		r.raise_for_status()
		metadata = r.json()
		return DBImage(**metadata)
	
	def read_image(self, id: bytes | int) -> bytes:
		"""
		Read an image's data.
		"""
		id_str = id.hex() if isinstance(id, bytes) else str(id)
		r = request_with_retry(self.session, 'GET', f'{self.url}/api/images/{id_str}', timeout=60)
		r.raise_for_status()
		return r.content
	
	def tag_image(self, id: bytes | int, tag: str | int):
		"""
		Add a tag to an image.
		"""
		id_str = id.hex() if isinstance(id, bytes) else str(id)
		r = request_with_retry(self.session, 'POST', f'{self.url}/api/images/{id_str}/tags/{tag}', timeout=30)
		r.raise_for_status()
	
	def untag_image(self, id: bytes | int, tag: str | int):
		"""
		Remove a tag from an image.
		"""
		id_str = id.hex() if isinstance(id, bytes) else str(id)
		r = request_with_retry(self.session, 'DELETE', f'{self.url}/api/images/{id_str}/tags/{tag}', timeout=30)
		r.raise_for_status()
	
	def add_image_attribute(self, id: bytes | int, key: str | int, value: str, singular: bool) -> bool:
		"""
		Add an attribute to an image. Returns False if the attribute already exists.
		"""
		id_str = id.hex() if isinstance(id, bytes) else str(id)
		r = request_with_retry(self.session, 'POST', f'{self.url}/api/images/{id_str}/attributes', json={'key': key, 'value': value, 'singular': singular}, timeout=30)
		if r.status_code == 409:
			return False
		r.raise_for_status()
		return True

	def remove_image_attribute(self, id: bytes | int, key: str | int, value: str):
		"""
		Remove an attribute from an image.
		"""
		id_str = id.hex() if isinstance(id, bytes) else str(id)
		r = request_with_retry(self.session, 'DELETE', f'{self.url}/api/images/{id_str}/attributes', json={'key': key, 'value': value}, timeout=30)
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
		r = request_with_retry(self.session, 'GET', f'{self.url}/api/search/images', params=params, timeout=120)
		if r.status_code != 200:
			raise Exception(f'Failed to search images ({r.status_code}): {r.text}')

		result = r.content
		return parse_search_response(result)
	
	def add_image(self, image_hash: bytes) -> bool:
		"""
		Add an image to the database. Returns False if the image already exists.
		"""
		r = request_with_retry(self.session, 'POST', f'{self.url}/api/images/{image_hash.hex()}', timeout=30)
		if r.status_code == 409:
			return False
		r.raise_for_status()
		return True
	
	def fetch_tags(self) -> list[DBTag]:
		response = request_with_retry(self.session, 'GET', f'{self.url}/api/tags', timeout=30)
		response.raise_for_status()
		tags = response.json()
		return [DBTag(**tag) for tag in tags]
	
	def add_image_by_path(self, src_path: Path, file_hash: bytes | None) -> bytes | None:
		"""
		Add an image stored on the filesystem of the database server to the database.
		The image is checked if it's valid before it is added.
		If the image is already in the database, it will not be added again.
		The image's inherent attributes are automatically added to the database as well.
		Returns the image's hash if it was added or already existed, or None if the image is invalid.
		"""
		src_path = Path(src_path)
		if not src_path.exists():
			raise FileNotFoundError(f'File not found: {src_path}')

		if file_hash is None:
			file_hash = sha256(src_path.read_bytes()).digest()
		else:
			assert isinstance(file_hash, bytes), f'Expected bytes, got {type(file_hash)}'
		
		file_hash_hex = file_hash.hex()

		dst_path = TAG_MACHINE_DEST_DIR / file_hash_hex[:2] / file_hash_hex[2:4] / file_hash_hex

		# Symlink the image
		image_size = None

		if not dst_path.exists():
			# Image isn't in the database. Check if it's valid
			image_size = is_valid_image(src_path)
			if image_size is None:
				#print(f'Invalid image: {src_path}')
				return None
			
			# Image is valid, copy it over to other-images first
			other_images_path = Path("/home/night/datasets/other-images/originals") / file_hash_hex[:2] / file_hash_hex[2:4] / file_hash_hex
			if not other_images_path.exists():
				other_images_tmp = other_images_path.with_suffix('.tmp')
				other_images_tmp.parent.mkdir(parents=True, exist_ok=True)
				other_images_tmp.write_bytes(src_path.read_bytes())
				other_images_tmp.rename(other_images_path)

			# Image is valid, symlink it in
			dst_path.parent.mkdir(parents=True, exist_ok=True)
			dst_path.symlink_to(other_images_path.absolute())

		# Add the image to the database, or check if it's already there
		self.add_image(file_hash)
		
		if image_size is not None:
			# Add image size attributes
			self.add_image_attribute(file_hash, 'image_width', str(image_size[0]), singular=True)
			self.add_image_attribute(file_hash, 'image_height', str(image_size[1]), singular=True)

		return file_hash


def request_with_retry(session: requests.Session, method: str, url: str, **kwargs) -> requests.Response:
	for i in range(4):
		try:
			response = session.request(method, url, **kwargs)
			if response.status_code >= 200 and response.status_code < 500:
				return response
			
			response.raise_for_status()
			return response
		except requests.RequestException as e:
			if i == 3:
				raise e
			time.sleep(2 ** i)  # Exponential backoff
			continue
	
	raise NotImplementedError() # Should not reach here


def is_valid_image(path: Path | str) -> tuple[int, int] | None:
	"""
	Check if the given image is valid, returning the image size if so, or None otherwise.
	In our case, that means it can be loaded with PIL,
	it's not animated, and it doesn't have an alpha channel.
	"""
	try:
		image = Image.open(path)
	except:  # noqa: E722
		return None
	
	# Check if gif
	if hasattr(image, 'is_animated') and image.is_animated: # type: ignore
		return None
	
	# Check for transparency
	if image.mode == 'RGBA' or image.mode == 'LA':
		alpha_channel = image.getchannel('A')
		if alpha_channel.getextrema() != (255, 255):
			return None
	
	# Check if not RGB
	#if image.mode != 'RGB':
	#	return None
	
	return image.size


def parse_search_response(response: bytes) -> NDArray[np.uint32] | NDArray[np.uint8] | list[SearchResultImage]:
	assert response[:3] == b"TMS", f"Expected TMSR header, got {response[:3]}"
	has_ids = response[3] & (1 << 3) != 0
	has_hashes = response[3] & (1 << 2) != 0
	has_tags = response[3] & (1 << 1) != 0
	has_attributes = response[3] & (1 << 0) != 0

	if has_ids and not has_hashes and not has_tags and not has_attributes:
		# ID response
		return np.frombuffer(response[4:], dtype=np.uint32)
	elif has_hashes and not has_ids and not has_tags and not has_attributes:
		# Hash response
		return np.frombuffer(response[4:], dtype=np.uint8).reshape(-1, 32)
	else:
		# Image response
		return parse_search_response_images(has_ids, has_hashes, has_tags, has_attributes, response[4:])


# def parse_search_response(response: SearchResultResponse) -> np.ndarray | list[bytes] | list[SearchResultImage]:
# 	data = response.Data()
# 	assert data is not None
# 	response_type = response.DataType()

# 	if response_type == ResponseType.IDResponse:
# 		result = IDResponse()
# 		result.Init(data.Bytes, data.Pos)
# 		result = result.IdsAsNumpy()
# 		assert isinstance(result, np.ndarray)
# 		return result
# 	elif response_type == ResponseType.HashResponse:
# 		result = HashResponse()
# 		result.Init(data.Bytes, data.Pos)
# 		hash_tables = (result.Hashes(i)._tab for i in range(result.HashesLength())) # type: ignore
# 		hashes = [hash.Bytes[hash.Pos:hash.Pos+32] for hash in hash_tables]
# 		return hashes
# 	elif response_type == ResponseType.ImageResponse:
# 		result = ImageResponse()
# 		result.Init(data.Bytes, data.Pos)
# 		images = []
# 		for i in range(result.ImagesLength()):
# 			image = result.Images(i)
# 			assert isinstance(image, ApiImage)
# 			id = image.Id()
# 			hash = image.Hash()
# 			if hash is not None:
# 				hash = hash._tab
# 				hash = hash.Bytes[hash.Pos:hash.Pos+32]
# 			tags: dict[int, int] | None = None
# 			if not image.TagsIsNone():
# 				tags = {}
# 				for i in range(image.TagsLength()):
# 					tag = image.Tags(i)
# 					assert isinstance(tag, TagWithBlame)
# 					k = tag.Tag()
# 					v = tag.Blame()
# 					assert isinstance(k, int), f'Expected int, got {type(k)}'
# 					assert isinstance(v, int), f'Expected int, got {type(v)}'
# 					tags[k] = v

# 			attributes = None
# 			if not image.AttributesIsNone():
# 				attributes = {}
# 				for i in range(image.AttributesLength()):
# 					attr = image.Attributes(i)
# 					assert isinstance(attr, AttributeWithBlame)
# 					key = attr.Key().decode('utf-8')
# 					value = attr.Value().decode('utf-8')
# 					blame = attr.Blame()
# 					if key not in attributes:
# 						attributes[key] = {}
# 					attributes[key][value] = blame
			
# 			images.append(SearchResultImage(id=id, hash=hash, tags=tags, attributes=attributes))
		
# 		return images
# 	else:
# 		raise NotImplementedError(f'Unknown response type: {response_type}')



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