import React, { useRef, useState, useEffect, useCallback } from 'react';
import Webcam from 'react-webcam';
import axios from 'axios';

function App() {
  const webcamRef = useRef(null); // setup webcam
  const isLiveRef = useRef(false); // setup live bounding box tracking
  const [detected, setDetected] = useState([]); // detected students on camera
  const [isLive, setIsLive] = useState(false); // is the webcam live
  const [allStudents, setAllStudents] = useState([]); // sets the full attendance list
  const [presentIds, setPresentIds] = useState([]);  // sets the present students

  const fetchAttendance = async () => {
    try {
      const res = await axios.get('http://localhost:8000/attendance');
      setPresentIds(res.data);
    } catch (err) {
      console.error("Could not fetch attendance:", err);
    }
  };

  const fetchAllStudents = async () => {
    try {
      const res = await axios.get('http://localhost:8000/students');
      setAllStudents(res.data);
    } catch (err) {
      console.error("Could not fetch students:", err);
    }
  };

  // when App runs, get all students
  useEffect(() => {
    fetchAllStudents();
  }, []);

  // when camera is live, update the attendance list
  useEffect(() => {
    let pollInterval;
    if (isLive) {
      pollInterval = setInterval(fetchAttendance, 100); // 1000 ms
    }
    return () => clearInterval(pollInterval);
  }, [isLive]);

  const handleStart = async () => {
    try {
      await axios.post('http://localhost:8000/start-registration');
      setDetected([]); 
      setPresentIds([]);
      setIsLive(true);
      isLiveRef.current = true;
      capture();
    } catch (err) {
      alert("Make sure your Python backend is running on port 8000!");
    }
  };

  const handleStop = () => {
    setIsLive(false);
    isLiveRef.current = false;
    setDetected([]);
  };

  const handleDelete = async (studentIdToRemove) => {
    try {
      await axios.delete(`http://localhost:8000/students/${studentIdToRemove}`);
      fetchAllStudents(); // update table
    } catch (err) {
      console.error(err);
      alert("Could not delete student from database.");
    }
  };

  const capture = useCallback(async () => {
    // If we hit stop, break the loop 
    if (!isLiveRef.current || !webcamRef.current) return;

    const imageSrc = webcamRef.current.getScreenshot();
    if (imageSrc) {
      const blob = await fetch(imageSrc).then((res) => res.blob());
      const formData = new FormData();
      formData.append('file', blob, 'frame.jpg');

      try {
        const response = await axios.post('http://localhost:8000/process-frame', formData);
        if(isLiveRef.current) {
          setDetected(response.data.detected || []);
        }
      } catch (err) {
        console.error("Backend error:", err);
      }
    }

    // wait to process the frame
    if (isLiveRef.current) {
      setTimeout(capture, 50); 
    }
  }, []);

  return (
    <div style={{ textAlign: 'center', padding: '20px' }}>
      <h1>Classroom Attendance</h1>
      
      <div style={{ marginBottom: '20px' }}>
        {!isLive ? (
          <button onClick={handleStart} style={startButtonStyle}>▶ Start Class Session</button>
        ) : (
          <button onClick={handleStop} style={stopButtonStyle}>■ Stop Attendance</button>
        )}
      </div>

      <div style={{ position: 'relative', display: 'inline-block' }}>
        <Webcam audio={false} ref={webcamRef} screenshotFormat="image/jpeg"  screenshotQuality={0.5}
        width={640} height={480} videoConstraints={{width: 640, height: 480, facingMode: "user"}} />

        {isLive && <div style={liveIndicatorStyle}>● LIVE</div>}

        
        {detected.map((face, index) => {
          // Calculate width and height from the coordinates
          const boxWidth = face.bounding_box.right - face.bounding_box.left;
          const boxHeight = face.bounding_box.bottom - face.bounding_box.top;
          
          // Green if known, Red if unknown
          const isKnown = face.name !== "Unknown";
          const boxColor = isKnown ? '#00ff00' : '#ff0000'; 

          return (
            <div 
              key={index} 
              style={{
                position: 'absolute',
                top: `${face.bounding_box.top}px`,
                left: `${face.bounding_box.left}px`,
                width: `${boxWidth}px`,
                height: `${boxHeight}px`,
                border: `3px solid ${boxColor}`,
                pointerEvents: 'none', 
                zIndex: 10
              }}
            >

              <div style={{
                position: 'absolute',
                top: '-25px', 
                left: '-3px',
                backgroundColor: boxColor,
                color: isKnown ? 'black' : 'white',
                padding: '2px 6px',
                fontSize: '14px',
                fontWeight: 'bold',
                whiteSpace: 'nowrap'
              }}>
                {face.name} {face.distance !== null ? `(${face.distance})` : ''}
              </div>
            </div>
          );
        })}
      </div>

      <UploadForm webcamRef={webcamRef} refreshList={fetchAllStudents} />

      <div style={attendanceContainerStyle}>
        <h3>Attendance List</h3>  
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Student ID</th>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Present</th>
              <th style={thStyle}>Remove</th>
            </tr>
          </thead>
          <tbody>
            {allStudents.map((student, i) => {
              const isPresent = presentIds.includes(student.student_id);
              return (
                <tr key={i} style={{ 
                  backgroundColor: isPresent ? '#e8f5e9' : '#ffebee',
                  transition: 'background-color 0.3s ease' 
                }}>
                  <td style={tdStyle}>{student.student_id}</td>
                  <td style={tdStyle}><strong>{student.name}</strong></td>
                  <td style={{ 
                    ...tdStyle, 
                    color: isPresent ? '#2e7d32' : '#c62828',
                  }}>
                    {isPresent ? "Yes" : "No"}
                  </td>
                  <td style={tdStyle}>
                    <button 
                      onClick={() => handleDelete(student.student_id, student.name)}
                      style={deleteButtonStyle}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UploadForm({ refreshList }) {
  const [name, setName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null); 

  const handleAdd = async () => {
    // Ensure non-empty inputs
    if (!name || !studentId || !selectedFile) {
      return alert("Please enter Name, ID, and select an image file.");
    }
    
    const formData = new FormData();
    formData.append('file', selectedFile); 
    formData.append('student_name', name);
    formData.append('student_id', studentId);

    try {
      const res = await axios.post('http://localhost:8000/add-student', formData);
      alert(`Upload Success! ${res.data.message}`);
      setName('');
      setStudentId('');
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = ""; 
      
      refreshList();
    } catch (err) {
      console.error(err);
      alert("Upload failed.");
    }
  };

  return (
    <div style={{ border: '1px solid #ccc', padding: '20px', marginTop: '20px', borderRadius: '8px', maxWidth: '500px', marginLeft: 'auto', marginRight: 'auto' }}>
      <h3>New Student Addition</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '15px' }}>
        <input 
          type="text" placeholder="Full Name" 
          value={name} onChange={(e) => setName(e.target.value)} 
          style={inputStyle} 
        />
        <input 
          type="text" placeholder="Student ID" 
          value={studentId} onChange={(e) => setStudentId(e.target.value)} 
          style={inputStyle} 
        />
        <input 
          type="file" 
          accept="image/*" 
          ref={fileInputRef}
          onChange={(e) => setSelectedFile(e.target.files[0])} 
          style={inputStyle} 
        />
      </div>
      <button onClick={handleAdd} style={regButtonStyle}>
        Update Student List
      </button>
    </div>
  );
}

const inputStyle = { padding: '8px', margin: '5px', borderRadius: '4px', border: '1px solid #ddd' };
const regButtonStyle = { padding: '8px 16px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' };
const startButtonStyle = { padding: '12px 24px', fontSize: '18px', cursor: 'pointer', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '50px', fontWeight: 'bold' };
const stopButtonStyle = { ...startButtonStyle, backgroundColor: '#dc3545' };
const liveIndicatorStyle = { position: 'absolute', top: '15px', left: '15px', color: '#ff4d4d', fontWeight: 'bold', backgroundColor: 'rgba(0,0,0,0.6)', padding: '5px 10px', borderRadius: '4px' };
const attendanceContainerStyle = { marginTop: '20px', maxWidth: '500px', marginLeft: 'auto', marginRight: 'auto', textAlign: 'left', border: '1px solid #ccc', padding: '20px', borderRadius: '8px' };
const tableStyle = { width: '100%', borderCollapse: 'collapse', marginTop: '10px', fontSize: '16px' };
const thStyle = { backgroundColor: '#f4f7f6', padding: '12px', borderBottom: '2px solid #ccc', textAlign: 'left', fontWeight: 'bold' };
const tdStyle = { padding: '12px', borderBottom: '1px solid #eee' };
const deleteButtonStyle = { padding: '6px 12px', color: 'black', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px' };

export default App;