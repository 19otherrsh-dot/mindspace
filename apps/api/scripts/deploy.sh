#!/bin/bash
set -e

echo "Building Mindspace API container..."
docker build -f Dockerfile -t mindspace-api:latest ../../

echo "Container built successfully. You can run it locally with:"
echo "docker-compose -f ../../docker-compose.prod.yml up -d"

echo "Or tag and push to your registry:"
echo "docker tag mindspace-api:latest registry.yourdomain.com/mindspace-api:latest"
echo "docker push registry.yourdomain.com/mindspace-api:latest"
