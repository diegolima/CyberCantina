FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package metadata and source code
COPY pyproject.toml ./
COPY app ./app

# Install package dependencies and optional embeddings
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir ".[embeddings]"

# Ensure default data directory exists
RUN mkdir -p /data

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
