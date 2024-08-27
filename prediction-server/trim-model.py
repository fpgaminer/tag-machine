#!/usr/bin/env python3
import torch
import sys


STRIP = set(['optimizer', 'lr_scheduler'])


def main():
	args = sys.argv[1:]
	if len(args) != 2:
		print('Usage: trim-model.py <input> <output>')
		return
	
	input_path = args[0]
	output_path = args[1]

	print('Loading...')
	model = torch.load(input_path, map_location=torch.device('cpu'))

	print('Stripping...')
	for key in list(model.keys()):
		if key in STRIP:
			del model[key]
	
	print('Saving...')
	torch.save(model, output_path)


if __name__ == '__main__':
	main()