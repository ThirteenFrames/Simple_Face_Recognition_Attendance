# Simple_Face_Recognition_Attendance

Simple web app that allows for attendance to be taken automatically with facial recognition!

A full-stack web application that automates classroom attendance using real-time facial recognition. 

The program captures webcam frames through React, and processes them by a FastAPI backend using the OpenCV and `face_recognition` libraries. 

# Setup

## Backend

Start a MySQL server and create a database called `registration_db`.

Change directory to backend: `cd backend`.

Create a `.env` file and add the SQL databse url: `DATABASE_URL=mysql+pymysql://<USERNAME>:<PASSWORD>@localhost:3306/registration_db`. 

Create a virtual environment: `python -m venv .venv`.

Activate the virtual environment. `.venv\Scripts\activate`.

Install dependencies: `pip install -r requirements.txt`.

Launch the backend: `uvicorn main:app --reload`.

## Frontend

Make sure to have npm installed. 

Change directory to frontend: `cd frontend`.

Install dependencies: `npm install`.

Once backend is running, launch the frontend: `npm start`.