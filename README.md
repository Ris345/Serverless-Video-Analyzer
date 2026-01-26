# Serverless Video Analyzer

A full-stack serverless application for automated technical video analysis using AWS (Lambda, S3, DynamoDB, API Gateway) and OpenAI (GPT-4o).

## Features
- **Upload**: Drag & drop video uploads directly to S3 via presigned URLs.
- **Analysis**: Automated extraction of keyframes and analysis of optical properties (lighting, focus, composition).
- **Context-Aware**: Uses chat history to guide the AI's analysis.
- **Serverless**: Zero server management. Scales automatically.
- **Infrastructure as Code**: Fully provisioned via Terraform.

## Architecture
1.  **Frontend**: Next.js (App Router, Tailwind CSS, Shadcn UI).
2.  **API**: Next.js API Routes + AWS API Gateway (S3 Proxy).
3.  **Storage**: 
    - `video-analyzer-videos-*` (Raw uploads)
    - `video-analyzer-results-*` (JSON Analysis)
    - DynamoDB `InterviewAnalysis` (Status tracking)
4.  **Compute**:
    - **Worker Lambda**: Python (OpenCV + OpenAI SDK). Triggered by S3 upload.

## Getting Started

### Prerequisites
- Node.js 18+
- Python 3.9+
- AWS CLI configured
- Terraform installed

### Installation
1.  Clone the repo:
    ```bash
    git clone https://github.com/Ris345/Serverless-Video-Analyzer.git
    cd Serverless-Video-Analyzer
    ```
2.  Install dependencies:
    ```bash
    npm install
    pip install -r requirements.txt
    ```

### Local Development
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000).

## Deployment

### 1. Infrastructure (Terraform)
```bash
cd terraform
terraform init
terraform apply
```

### 2. Backend (Lambda)
```bash
./deploy_worker.sh
```

## Security
- **Secrets**: Managed via `.env` (not committed).
- **IAM**: Least-privilege roles for Lambda and API Gateway.
- **Access**: Presigned URLs for secure S3 uploads.
