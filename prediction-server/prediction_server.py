#!/usr/bin/env python3
from dataclasses import dataclass
import functools
import json
import threading
from typing import Generic, TypeVar
from flask import Flask, request
from pathlib import Path
from flask_cors import CORS
import torch
import torch.amp
import logging
from PIL import Image
import torchvision.transforms.functional as TF
import concurrent.futures
import argparse
from transformers import AutoTokenizer, AutoModelForCausalLM, AutoProcessor, AutoModel
from torch import nn
import yaml
import io
from hashlib import sha256

from Models import VisionModel
from MultiModel import LlamaMultiModel


parser = argparse.ArgumentParser()
parser.add_argument('--image-dir', type=str, default='../rust-api/images')
parser.add_argument('--image-size', type=int, default=448)
parser.add_argument('--port', type=int, default=8087)
parser.add_argument('--host', type=str, default='127.0.0.1')
parser.add_argument('--model', type=str, default='models/io1nspv6-660')
parser.add_argument('--tag-assoc-model', type=str, default='tag_assoc_models/5kcpemm4')
#parser.add_argument('--vlm-model', type=str, default='models/joy-caption-9e1pdwl9-399872')
#parser.add_argument('--vlm-model', type=str, default='models/joy-caption-tad2lrx1-499968')
#parser.add_argument('--vlm-model', type=str, default='models/joy-caption-wpkklhc6-599808')
#parser.add_argument('--vlm-model', type=str, default='models/joy-caption-q1gbdzid-49920')
#parser.add_argument('--vlm-model', type=str, default='models/joy-caption-gfw8glv4-49920')
#parser.add_argument('--vlm-model', type=str, default='models/joy-caption-i0g1cgpe-599808')
#parser.add_argument('--vlm-model', type=str, default='models/joy-caption-9i6xt5iz-49920')
#parser.add_argument('--vlm-model', type=str, default='models/joy-caption-1zjx0z2i-499968')
#parser.add_argument('--vlm-model', type=str, default='models/joy-caption-rx4ifbpo-499968')
parser.add_argument('--vlm-model', type=str, default='models/joy-caption-9em124t2-499968')


IMAGE_DIR = Path('../rust-api/images')
IMAGE_SIZE = 448
#VLM_PROMPT = "A descriptive caption for this image:\n"


@dataclass
class TagPredictionJob:
	image: Image.Image


@dataclass
class ImageCaptioningJob:
	image: Image.Image
	prompt: str


@dataclass
class TagAssocJob:
	tags: list[str]


@dataclass
class TagImageAssocJob:
	tags: list[str]
	image: Image.Image
	image_hash: bytes


thread_local = threading.local()


app = Flask(__name__)
CORS(app)


def load_model(model_path: Path):
	model = VisionModel.load_model(model_path, 'cuda')
	model.eval()
	model = torch.compile(model, mode="reduce-overhead", fullgraph=True)

	return model


def load_tag_assoc_model(model_path: Path):
	"""
	Load the tag association model.
	This models predicts tags based only on the current tags.
	"""
	tag_to_id = json.load(open(model_path / 'tag_to_id.json'))
	id_to_tag = {i: tag for tag, i in tag_to_id.items()}
	id_to_tag[0] = '<PAD>'
	id_to_tag[1] = '<BOS>'
	id_to_tag[2] = '<EOS>'
	tag_to_id['<PAD>'] = 0
	tag_to_id['<BOS>'] = 1
	tag_to_id['<EOS>'] = 2

	model = LlamaMultiModel.from_pretrained(model_path / 'model', image_embedding_dim=768)
	assert isinstance(model, LlamaMultiModel)
	model = model.to('cuda') # type: ignore
	#model = torch.compile(model)  # Input sizes vary a lot
	model.eval()

	return model, tag_to_id, id_to_tag


class ImageAdapter(nn.Module):
	def __init__(self, input_features: int, output_features: int, ln1: bool, pos_emb: bool, num_image_tokens: int, deep_extract: bool):
		super().__init__()
		self.deep_extract = deep_extract

		if self.deep_extract:
			input_features = input_features * 5

		self.linear1 = nn.Linear(input_features, output_features)
		self.activation = nn.GELU()
		self.linear2 = nn.Linear(output_features, output_features)
		self.ln1 = nn.Identity() if not ln1 else nn.LayerNorm(input_features)
		self.pos_emb = None if not pos_emb else nn.Parameter(torch.zeros(num_image_tokens, input_features))

		# Mode token
		#self.mode_token = nn.Embedding(n_modes, output_features)
		#self.mode_token.weight.data.normal_(mean=0.0, std=0.02)   # Matches HF's implementation of llama3

		# Other tokens (<|image_start|>, <|image_end|>, <|eot_id|>)
		self.other_tokens = nn.Embedding(3, output_features)
		self.other_tokens.weight.data.normal_(mean=0.0, std=0.02)   # Matches HF's implementation of llama3

	def forward(self, vision_outputs: torch.Tensor):
		if self.deep_extract:
			x = torch.concat((
				vision_outputs[-2],
				vision_outputs[3],
				vision_outputs[7],
				vision_outputs[13],
				vision_outputs[20],
			), dim=-1)
			assert len(x.shape) == 3, f"Expected 3, got {len(x.shape)}"  # batch, tokens, features
			assert x.shape[-1] == vision_outputs[-2].shape[-1] * 5, f"Expected {vision_outputs[-2].shape[-1] * 5}, got {x.shape[-1]}"
		else:
			x = vision_outputs[-2]

		x = self.ln1(x)

		if self.pos_emb is not None:
			assert x.shape[-2:] == self.pos_emb.shape, f"Expected {self.pos_emb.shape}, got {x.shape[-2:]}"
			x = x + self.pos_emb

		x = self.linear1(x)
		x = self.activation(x)
		x = self.linear2(x)

		# Mode token
		#mode_token = self.mode_token(mode)
		#assert mode_token.shape == (x.shape[0], mode_token.shape[1], x.shape[2]), f"Expected {(x.shape[0], 1, x.shape[2])}, got {mode_token.shape}"
		#x = torch.cat((x, mode_token), dim=1)

		# <|image_start|>, IMAGE, <|image_end|>, <|eot_id|>
		# The <|eot_id|> token will be moved around and injected later
		other_tokens = self.other_tokens(torch.tensor([0, 1], device=self.other_tokens.weight.device).expand(x.shape[0], -1))
		assert other_tokens.shape == (x.shape[0], 2, x.shape[2]), f"Expected {(x.shape[0], 2, x.shape[2])}, got {other_tokens.shape}"
		x = torch.cat((other_tokens[:, 0:1], x, other_tokens[:, 1:2]), dim=1)

		return x

	def get_eot_embedding(self):
		return self.other_tokens(torch.tensor([2], device=self.other_tokens.weight.device)).squeeze(0)


def load_vlm_model(model_path: Path):
	"""
	Load the VLM model.
	"""
	config = yaml.safe_load((model_path / "config.yaml").read_text())

	tokenizer = AutoTokenizer.from_pretrained(config['text_model'])
	if (model_path / "text_model").exists():
		logging.info("Loading VLM's custom text model")
		text_model = AutoModelForCausalLM.from_pretrained(model_path / "text_model", device_map='cuda', torch_dtype=torch.bfloat16)
	else:
		text_model = AutoModelForCausalLM.from_pretrained(config['text_model'], device_map='cuda', torch_dtype=torch.bfloat16)
	#assert isinstance(text_model, LlamaForCausalLM)
	text_model.eval()
	#text_model.forward = torch.compile(text_model.forward, mode="reduce-overhead", fullgraph=True)

	clip_processor = AutoProcessor.from_pretrained(config['clip_model'])
	clip_model = AutoModel.from_pretrained(config['clip_model'])
	clip_model = clip_model.vision_model
	if (Path(model_path) / "vision_model.pt").exists():
		logging.info("Loading VLM's custom vision model")
		checkpoint = torch.load(Path(model_path) / "vision_model.pt", map_location='cpu')
		checkpoint = {k.replace("_orig_mod.module.", ""): v for k, v in checkpoint.items()}
		clip_model.load_state_dict(checkpoint)
		del checkpoint
	elif (Path(model_path) / "clip_model.pt").exists():
		logging.info("Loading VLM's custom vision model")
		checkpoint = torch.load(Path(model_path) / "clip_model.pt", map_location='cpu')
		checkpoint = {k.replace("_orig_mod.module.", ""): v for k, v in checkpoint.items()}
		clip_model.load_state_dict(checkpoint)
		del checkpoint

	clip_model.eval()
	clip_model.requires_grad_(False)
	clip_model.to('cuda')

	image_adapter = ImageAdapter(clip_model.config.hidden_size, text_model.config.hidden_size, ln1=False, pos_emb=False, num_image_tokens=1, deep_extract=False)#, n_modes=3*7)
	checkpoint = torch.load(Path(model_path) / "image_adapter.pt", map_location='cpu')
	image_adapter.load_state_dict(checkpoint)
	image_adapter.eval()
	image_adapter.to('cuda')

	return tokenizer, text_model, clip_processor, clip_model, image_adapter


@torch.no_grad()
def run_vlm_model(prompt_str: str, tokenizer, text_model, clip_processor, clip_model, image_adapter, image: Image.Image) -> str:
	image = image.resize((384, 384), Image.LANCZOS)
	pixel_values = TF.pil_to_tensor(image).unsqueeze(0) / 255.0
	pixel_values = TF.normalize(pixel_values, [0.5], [0.5])
	#image = clip_processor(images=image.convert('RGB'), return_tensors='pt').pixel_values
	pixel_values = pixel_values.to('cuda')

	prompt = tokenizer.encode(prompt_str, return_tensors='pt', padding=False, truncation=False, add_special_tokens=False)

	# Embed image
	with torch.amp.autocast_mode.autocast('cuda', enabled=True):
		vision_outputs = clip_model(pixel_values=pixel_values, output_hidden_states=True)
		image_features = vision_outputs.hidden_states
		embedded_images = image_adapter(image_features)
		#embedded_images = image_adapter(image_features, torch.tensor([7,8,9,10,11,12,13], device='cuda').unsqueeze(0))
		embedded_images = embedded_images.to('cuda')

	# Embed prompt
	prompt_embeds = text_model.model.embed_tokens(prompt.to('cuda'))
	assert prompt_embeds.shape == (1, prompt.shape[1], text_model.config.hidden_size), f"Prompt shape is {prompt_embeds.shape}, expected {(1, prompt.shape[1], text_model.config.hidden_size)}"
	embedded_bos = text_model.model.embed_tokens(torch.tensor([[tokenizer.bos_token_id]], device=text_model.device, dtype=torch.int64))
	eot_embed = image_adapter.get_eot_embedding().unsqueeze(0).to(dtype=text_model.dtype)

	# Construct prompts
	inputs_embeds = torch.cat([
		embedded_bos.expand(embedded_images.shape[0], -1, -1),
		embedded_images.to(dtype=embedded_bos.dtype),
		prompt_embeds.expand(embedded_images.shape[0], -1, -1),
		eot_embed.expand(embedded_images.shape[0], -1, -1),
	], dim=1)

	#generated_captions = []

	input_ids = torch.cat([
		torch.tensor([[tokenizer.bos_token_id]], dtype=torch.long),
		torch.zeros((1, embedded_images.shape[1]), dtype=torch.long),
		prompt,
		torch.tensor([[tokenizer.convert_tokens_to_ids("<|eot_id|>")]], dtype=torch.long),
	], dim=1).to('cuda')
	attention_mask = torch.ones_like(input_ids)
	print(input_ids)

	#generate_ids = text_model.generate(input_ids, inputs_embeds=inputs_embeds, attention_mask=attention_mask, max_new_tokens=256, do_sample=False, suppress_tokens=None)
	#generate_ids = text_model.generate(input_ids, inputs_embeds=inputs_embeds, attention_mask=attention_mask, max_new_tokens=256, do_sample=True, top_k=10, temperature=0.2, suppress_tokens=None)
	generate_ids = text_model.generate(input_ids, inputs_embeds=inputs_embeds, attention_mask=attention_mask, max_new_tokens=256, do_sample=True, suppress_tokens=None)   # Uses the default which is temp=0.6, top_p=0.9

	# Trim off the prompt
	generate_ids = generate_ids[:, input_ids.shape[1]:]
	#print(generate_ids)
	if generate_ids[0][-1] == tokenizer.eos_token_id or generate_ids[0][-1] == tokenizer.convert_tokens_to_ids("<|eot_id|>"):
		generate_ids = generate_ids[:, :-1]

	caption = tokenizer.batch_decode(generate_ids, skip_special_tokens=False, clean_up_tokenization_spaces=False)[0]

	return caption



@app.route('/predict', methods=['POST'])
def predict():
	"""Predict tags for an image."""
	try:
		file = request.files.get('image')
		if file is None:
			return 'No image provided', 400
		image = Image.open(file.stream)
		image.load()
		future = executor.submit(tag_prediction_worker, TagPredictionJob(image))
		result = future.result()
		if result is None:
			return 'Prediction failed', 500
		
		return result
	except Exception as e:
		logging.error(f'Prediction failed: {e}')
		return 'Prediction failed', 500


@app.route('/tag_assoc', methods=['POST'])
def tag_assoc():
	"""Predict tags based on the given tags."""
	try:
		tags = request.form.getlist('tags')
		file = request.files.get('image')
		if file is None:
			future = executor.submit(tag_assoc_worker, TagAssocJob(tags))
		else:
			data = file.stream.read()
			image = Image.open(io.BytesIO(data))
			image.load()
			image_hash = sha256(data).digest()
			future = executor.submit(tag_image_assoc_worker, TagImageAssocJob(tags, image, image_hash))
		
		result = future.result()
		if result is None:
			return 'Prediction failed', 500
		
		return result
	except Exception as e:
		logging.error(f'Prediction failed: {e}')
		return 'Prediction failed', 500


@app.route('/caption', methods=['POST'])
def caption():
	"""Generate a caption for an image using the VLM model."""
	try:
		prompt = request.form.get('prompt')
		if prompt is None:
			return 'No prompt provided', 400
		file = request.files.get('image')
		if file is None:
			return 'No image provided', 400
		image = Image.open(file.stream)
		image.load()
		future = executor.submit(captioning_worker, ImageCaptioningJob(image, prompt))
		result = future.result()
		if result is None:
			return 'Prediction failed', 500
		
		return result
	except Exception as e:
		logging.error(f'Prediction failed: {e}')
		return 'Prediction failed', 500


def prediction_worker_init(model_path: Path, tag_assoc_model_path: Path):
	logging.info('Loading image model')
	thread_local.model = load_model(model_path)
	thread_local.model.eval()

	with open(model_path / 'top_tags.txt') as f:
		thread_local.top_tags = [line.strip() for line in f.readlines() if line.strip()]

	logging.info('Image model loaded')

	logging.info('Loading tag association model')
	thread_local.tag_assoc_model, thread_local.tag_to_id, thread_local.id_to_tag = load_tag_assoc_model(tag_assoc_model_path)
	logging.info('Tag association model loaded')

	thread_local.image_embedding_cache = LruCache(maxsize=1000)

	assert len(thread_local.tag_to_id) == len(thread_local.top_tags) + 3

	logging.info('Loading VLM model')
	thread_local.vlm_model = load_vlm_model(Path(args.vlm_model))
	logging.info('VLM model loaded')


def prepare_image(image: Image.Image) -> torch.Tensor:
	"""Prepare an image for embedding."""
	# Pad image to square
	image_shape = image.size
	max_dim = max(image_shape)
	pad_left = (max_dim - image_shape[0]) // 2
	pad_top = (max_dim - image_shape[1]) // 2

	padded_image = Image.new('RGB', (max_dim, max_dim), (255, 255, 255)) # type: ignore
	padded_image.paste(image, (pad_left, pad_top))

	# Resize image
	if max_dim != IMAGE_SIZE:
		padded_image = padded_image.resize((IMAGE_SIZE, IMAGE_SIZE), Image.BICUBIC)
	
	# Convert to tensor
	image_tensor = TF.pil_to_tensor(padded_image) / 255.0

	# Normalize
	image_tensor = TF.normalize(image_tensor, mean=[0.48145466, 0.4578275, 0.40821073], std=[0.26862954, 0.26130258, 0.27577711])

	return image_tensor


@torch.no_grad()
def captioning_worker(job: ImageCaptioningJob):
	image = job.image

	try:
		tokenizer, text_model, clip_processor, clip_model, image_adapter = thread_local.vlm_model
		caption = run_vlm_model(job.prompt, tokenizer, text_model, clip_processor, clip_model, image_adapter, image)
	except Exception as e:
		logging.error(f'Captioning failed: {e}')
		return None
	
	return {'caption': caption}


@torch.no_grad()
def tag_prediction_worker(job: TagPredictionJob) -> dict[str, float] | None:
	model = thread_local.model
	image = job.image

	try:
		image_tensor = prepare_image(image)

		batch = {
			'image': image_tensor.unsqueeze(0).to('cuda'),
		}

		with torch.amp.autocast_mode.autocast('cuda', enabled=True):
			preds = model(batch)
	except Exception as e:
		logging.error(f'Tag prediction failed: {e}')
		return None

	tags = preds['tags'][0].sigmoid().cpu().tolist()
	result = {tag: prob for tag, prob in zip(thread_local.top_tags, tags)}

	return result


@torch.no_grad()
def tag_assoc_worker(job: TagAssocJob) -> dict[str, float] | None:
	model = thread_local.tag_assoc_model
	tag_to_id = thread_local.tag_to_id
	id_to_tag = thread_local.id_to_tag

	logging.info(f'Predicting tag associations for {job.tags}')

	input_tags = [tag_to_id[tag] for tag in job.tags if tag in tag_to_id]

	try:
		input_tags = [1] + input_tags   # Add the BOS token

		batch = {
			'input_ids': torch.tensor([input_tags]).cuda(),
			#'attention_mask': torch.tensor([[1]]).cuda(),
			#'position_ids': torch.tensor([[0]]).cuda(),
		}

		with torch.no_grad():
			output = model(**batch)

		# Probabilities
		probs = torch.softmax(output.logits[0, -1, :], dim=-1).cpu()

		# Top tags
		top20 = torch.topk(probs, 20)
	except Exception as e:
		logging.error(f'Prediction failed for {job.tags}: {e}')
		return None
	
	logging.info(f'Predicted for {job.tags}')

	predictions = {id_to_tag[i]: p for i, p in zip(top20.indices.tolist(), top20.values.tolist())}

	return predictions


@torch.no_grad()
def get_image_embedding(image: Image.Image) -> torch.Tensor:
	image_model = thread_local.model
	model = thread_local.tag_assoc_model

	image_tensor = prepare_image(image)

	batch = {
		'image': image_tensor.unsqueeze(0).to('cuda', dtype=torch.float32),
	}

	with torch.amp.autocast_mode.autocast('cuda', enabled=True):
		preds = image_model(batch, return_embeddings=True)
	
	image_embedding = preds['embeddings'][0]
	image_embedding = model.image_proj(image_embedding)

	return image_embedding


@torch.no_grad()
def tag_image_assoc_worker(job: TagImageAssocJob) -> dict[str, float] | None:
	image_embedding_cache = thread_local.image_embedding_cache
	model = thread_local.tag_assoc_model
	image_hash = job.image_hash.hex()
	image = job.image
	tag_to_id = thread_local.tag_to_id
	id_to_tag = thread_local.id_to_tag

	logging.info(f'Predicting image/tag associations for {image_hash}: {job.tags}')

	input_tags = [tag_to_id[tag] for tag in job.tags if tag in tag_to_id]

	try:
		image_embedding = image_embedding_cache.get(image_hash, functools.partial(get_image_embedding, image))

		input_tags = [1] + input_tags   # Add the BOS token

		input_ids = torch.tensor([input_tags]).cuda()
		input_embeds = model.model.embed_tokens(input_ids)
		input_embeds[0, 0] = image_embedding

		batch = {
			#'input_ids': torch.tensor([input_tags]).cuda(),
			#'attention_mask': torch.tensor([[1]]).cuda(),
			#'position_ids': torch.tensor([[0]]).cuda(),
			'inputs_embeds': input_embeds,
		}

		with torch.no_grad():
			output = model(**batch)

		# Probabilities
		probs = torch.softmax(output.logits[0, -1, :], dim=-1).cpu()

		# Top tags
		top20 = torch.topk(probs, 20)
	except Exception as e:
		logging.error(f'Prediction failed for {job.tags}: {e}')
		return None
	
	logging.info(f'Predicted for {job.tags}')

	predictions = {id_to_tag[i]: p for i, p in zip(top20.indices.tolist(), top20.values.tolist())}

	return predictions


T = TypeVar('T')
K = TypeVar('K')

class LruCache(Generic[T, K]):
	cache: dict[K, T]
	queue: list[K]

	def __init__(self, maxsize: int):
		self.maxsize = maxsize
		self.cache = {}
		self.queue = []
	
	def get(self, key: K, func) -> T:
		if key in self.cache:
			self.queue.remove(key)
			self.queue.append(key)
			return self.cache[key]
		
		if len(self.queue) >= self.maxsize:
			del self.cache[self.queue.pop(0)]
		
		value = func()
		self.cache[key] = value
		self.queue.append(key)

		return value


if __name__ == '__main__':
	logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')

	args = parser.parse_args()
	IMAGE_DIR = Path(args.image_dir)
	IMAGE_SIZE = args.image_size

	executor = concurrent.futures.ThreadPoolExecutor(max_workers=1, initializer=prediction_worker_init, initargs=(Path(args.model), Path(args.tag_assoc_model)))

	app.run(host=args.host, port=args.port, debug=False, threaded=True)