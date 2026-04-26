ARG BUILD_FROM=alpine:latest

# Stage 1: Build the frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# Stage 2: Final image
FROM $BUILD_FROM

# Install dependencies
RUN apk update && \
    apk add --no-cache python3 py3-pip curl openssl ca-certificates jq netcat-openbsd bash

# Set working directory to /app
WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir --break-system-packages -r requirements.txt

# Copy application files (Python scripts and root files)
COPY *.py ./
COPY *.yaml ./

# Copy only the built frontend from builder stage
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Copy scripts to root
COPY ssl-setup.sh /
COPY run.sh /

# Fix permissions
RUN chmod a+x *.py && chmod a+x /run.sh /ssl-setup.sh

EXPOSE 8099 8443 8555 8080

CMD ["/run.sh"]