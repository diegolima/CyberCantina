FROM python:3.14-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Install runtime utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create unprivileged application user
RUN groupadd -g 1000 cantina && \
    useradd -u 1000 -g cantina -s /bin/bash -m cantina

WORKDIR /app

# Step 1: Cache dependencies (install requirements before copying source code)
COPY pyproject.toml ./
RUN mkdir app && touch app/__init__.py && \
    pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir ".[embeddings]" && \
    rm -rf app

# Step 2: Copy application code and install project
COPY app ./app
RUN pip install --no-cache-dir --no-deps -e .

# Step 3: Setup data directory and permissions
RUN mkdir -p /data && chown -R cantina:cantina /app /data

USER cantina

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
