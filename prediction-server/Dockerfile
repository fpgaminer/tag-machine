#FROM nvcr.io/nvidia/pytorch:23.10-py3
FROM nvcr.io/nvidia/pytorch:24.05-py3

# Install dependencies
RUN apt-get update && apt-get install -y --no-install-recommends libwebp-dev libwebp7
RUN pip install --upgrade Flask flask-cors transformers Pillow accelerate sentencepiece peft

WORKDIR /app

# Copy the files
COPY Models.py /app/Models.py
COPY MultiModel.py /app/MultiModel.py
COPY prediction_server.py /app/prediction_server.py

# Ports
EXPOSE 8087

# Run the server
CMD ["python", "prediction_server.py", "--host", "0.0.0.0", "--image-dir", "/app/images"]