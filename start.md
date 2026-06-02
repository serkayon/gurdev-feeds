>>>>> cd backend; cd app; $env:DATABASE_URL="postgresql+psycopg://YOUR_USER:YOUR_PASSWORD@localhost:5432/poultry"; venv\Scripts\activate; uvicorn main:app --reload --host 127.0.0.1 --port 8007

>>>>> cd frontend && npm run dev                                             >>>> for poultry dashboard

>cd backend && cd database && venv\Scripts\activate

>python schema.py

>cd backend && cd app && venv\Scripts\activate

>uvicorn main:app --host 0.0.0.0 --port 8000

>cd frontend

>npm run dev

>cd backend && cd n720 && venv\Scripts\activate

>uvicorn app:app --host 0.0.0.0 --port 8011

>cd demo-hmi

>npm run dev

> ip http://43.205.124.78/   windows

> ip http://65.2.181.255/    linux

> n720 ip 192.168.31.7  local wifi busan tech

git add .
git commit -m "updated feature"
git push
git pull


pip install fastapi uvicorn paho-mqtt
no done fall back to default create the batch with null recipe id