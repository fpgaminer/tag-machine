from transformers.models.llama.modeling_llama import LlamaConfig, LlamaForCausalLM
from transformers.modeling_outputs import BaseModelOutputWithPast
from typing import Optional, Union, List, Tuple
import torch
import torch.nn as nn


class LlamaMultiModel(LlamaForCausalLM):
	def __init__(self, config: LlamaConfig, image_embedding_dim: int):
		super().__init__(config)
		self.image_proj = nn.Linear(image_embedding_dim, config.hidden_size)
	