from fastapi import FastAPI, UploadFile, File, Depends, Form, HTTPException
from sqlalchemy import create_engine, Column, Integer, String, DateTime, LargeBinary
from sqlalchemy.orm import declarative_base, sessionmaker, Session
import numpy as np
import cv2
import datetime
from typing import cast
import face_recognition_models
import face_recognition
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

load_dotenv()

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
    ],
    allow_methods=["*"]
)

# ---------------------------------------------------------
# 0. Persistent Memory (Keeps track of registration)
# ---------------------------------------------------------
student_frame_counts = {} # (student_id, number of frames observed)
FRAME_THRESHOLD = 5

# ---------------------------------------------------------
# 1. Define databases
# ---------------------------------------------------------

SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL")
if(SQLALCHEMY_DATABASE_URL is None):
    raise ValueError("sql database .env variable not set.")

engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class Registration(Base):
    __tablename__ = "attendance"
    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String(20), unique=True, index=True)
    student_name = Column(String(50), index=True)
    timestamp = Column(DateTime, default=datetime.datetime.now)

class Student(Base):
    __tablename__ = "students"
    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(String(20), unique=True, index=True)
    student_name = Column(String(50))
    encoding_binary = Column(LargeBinary)

Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ---------------------------------------------------------
# 2. In-Memory Face Store (For Demonstration)
# ---------------------------------------------------------
# In a production app, you might load these encodings from a file or DB on startup.
known_face_encodings = []
known_face_metadata = [] 

# ---------------------------------------------------------
# 3. Endpoints
# ---------------------------------------------------------

# Add a new student to the database
@app.post("/add-student")
async def add_student(student_name: str = Form(...), student_id: str = Form(...), file: UploadFile = File(...), db: Session = Depends(get_db)):
    contents = await file.read()
    img = cv2.imdecode(np.frombuffer(contents, np.uint8), cv2.IMREAD_COLOR)
    
    if img is None:
        return {"error": "Error. Could not decode the image."}
        
    rgb_img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    encodings = face_recognition.face_encodings(rgb_img)
    
    if not encodings:
        return {"error": "Error. No face found in the image."}
        
    # Convert encodings to LargeBinary format
    encoding_binary = encodings[0].tobytes()
    
    # Create a student entry in the database and store it
    student = Student(student_id=student_id, student_name=student_name, encoding_binary=encoding_binary)
    db.add(student)
    db.commit()
    
    return {"message": f"Student {student_name} (ID: {student_id}) uploaded successfully!"}

# Delete a student from the database
@app.delete("/students/{student_id}")
def delete_student(student_id: str, db: Session = Depends(get_db)):
    # Find the student by their unique student_id
    student = db.query(Student).filter(Student.student_id == student_id).first()
    
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    
    # Delete and commit the change
    db.delete(student)
    db.commit()
    
    return {"message": f"Student {student_id} removed successfully"}

# Begin the registration process. Clear all counters and attendance database. 
@app.post("/start-registration")
async def start_registration(db: Session = Depends(get_db)):
    student_frame_counts.clear()
    known_face_encodings.clear()
    known_face_metadata.clear()
    db.query(Registration).delete()
    db.commit()
    
    # move student data from storage to main memory
    for student in db.query(Student).all():
        encoding = np.frombuffer(cast(bytes, student.encoding_binary), dtype=np.float64)
        known_face_encodings.append(encoding)
        
        known_face_metadata.append({
            "name": student.student_name, 
            "id": student.student_id
        })
        student_frame_counts[student.student_id] = 0
    
    return {"message": f"Registration started."}

# Get all students from the database. 
@app.get("/students")
def get_all_students(db: Session = Depends(get_db)):
    # Fetch all students, but exclude the heavy binary image data
    students = db.query(Student).all()
    return [{"student_id": s.student_id, "name": s.student_name} for s in students]

# Get all PRESENT students from the databse
@app.get("/attendance")
def get_attendance(db: Session = Depends(get_db)):
    records = db.query(Registration.student_id).all()
    return [r[0] for r in records] # ONLY RETURNS STUDENT ID

# Looks at an image and identifies present students. 
@app.post("/process-frame")
async def process_frame(file: UploadFile = File(...), db: Session = Depends(get_db)):
    contents = await file.read()
    img = cv2.imdecode(np.frombuffer(contents, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return {"error": "Error. Could not decode the image."}
    
    small_img = cv2.resize(img, (0, 0), fx=0.25, fy=0.25)
    rgb_small_img = cv2.cvtColor(small_img, cv2.COLOR_BGR2RGB)

    # Find faces
    face_locations = face_recognition.face_locations(rgb_small_img)
    face_encodings = face_recognition.face_encodings(rgb_small_img, face_locations)
    detected_students = []

    for (top, right, bottom, left), face_encoding in zip(face_locations, face_encodings):
        student_name = "Unknown"
        current_distance = None
        
        face_distances = face_recognition.face_distance(known_face_encodings, face_encoding)
        
        if len(face_distances) > 0:
            best_match_index = np.argmin(face_distances)
            current_distance = round(face_distances[best_match_index], 2)
            
            TOLERANCE = 0.55
            
            if face_distances[best_match_index] < TOLERANCE:
                student_name = known_face_metadata[best_match_index]["name"]
                student_id = known_face_metadata[best_match_index]["id"]

                student_frame_counts[student_id] += 1
                if(student_frame_counts[student_id] == FRAME_THRESHOLD):
                    try:
                        new_record = Registration(student_name=student_name, student_id=student_id)
                        db.add(new_record)
                        db.commit()
                    except Exception:
                        db.rollback()

        detected_students.append({
            "name": student_name,
            "distance": current_distance,
            "bounding_box": {"top": top*4, "right": right*4, "bottom": bottom*4, "left": left*4}
        })

    return {"detected": detected_students}
