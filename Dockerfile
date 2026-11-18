# AddressIQ in one container: the React app is built first, then FastAPI serves it together with the API on one port.
#   docker build -t addressiq .
#   docker run -p 8000:8000 -e ADDRESSIQ_SECRET=change-me -v addressiq-data:/data -e ADDRESSIQ_DB=/data/app.sqlite addressiq
# Open http://localhost:8000

FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
# "npm install" rather than "npm ci": the lock file was written on Windows and npm ci can skip the Linux build binaries
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PYTHONUTF8=1
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ backend/
COPY scripts/ scripts/
COPY data/gazetteer.sqlite data/sample_orders.csv data/
COPY --from=web /web/dist frontend/dist
WORKDIR /app/backend
EXPOSE 8000
# hosts such as Render / Railway / Fly pass the port in $PORT
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
