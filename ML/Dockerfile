# Build from the repository root: docker build -f ML/Dockerfile -t studytwin-ml .
FROM python:3.11-slim

WORKDIR /app
COPY ML/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY ML/ /app/ML/
COPY data/studytwin_ml_training_data.csv /app/data/studytwin_ml_training_data.csv
RUN python /app/ML/model.py

ENV PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["sh", "-c", "uvicorn ML.api:app --host 0.0.0.0 --port ${PORT:-8000}"]
