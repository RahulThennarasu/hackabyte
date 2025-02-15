import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import Groq, { toFile } from "groq-sdk"; // Import Groq for transcription
import "./App.css";
import veritasLogo from "./images/VERITAS.png";


// Define types for the response data
interface AnalysisResponse {
  analysis: string;
  sources: string[];
}

interface EmotionScores {
  confusion: number;
  interest: number;
  pride: number;
  determination: number;
  concentration: number;
}

const App: React.FC = () => {
  const [statement, setStatement] = useState<string>("");
  const [analysis, setAnalysis] = useState<string>("");
  const [sources, setSources] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [transcript, setTranscript] = useState<string>("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [emotionScores, setEmotionScores] = useState<EmotionScores>({
    confusion: 0,
    interest: 0,
    pride: 0,
    determination: 0,
    concentration: 0,
  });

  const videoRef = useRef<HTMLVideoElement | null>(null); // Reference for video element
  const arecorder = useRef<MediaRecorder | null>(null); // MediaRecorder instance
  const astream = useRef<MediaStream | null>(null); // Audio stream
  const canvasRef = useRef<HTMLCanvasElement | null>(null); // Canvas for capturing frames
  const humeSocket = useRef<WebSocket | null>(null); // Hume AI WebSocket

  // Instantiate Groq with your API Key
  const groq = new Groq({
    apiKey: process.env.REACT_APP_GROQ_API_KEY as string,
    dangerouslyAllowBrowser: true,
  });

  // Effect to handle audio recording and transcription
  useEffect(() => {
    if (stream) {
      astream.current = new MediaStream();
      for (const track of stream.getAudioTracks()) {
        astream.current.addTrack(track);
      }

      arecorder.current = new MediaRecorder(astream.current);
      arecorder.current.ondataavailable = async (e) => {
        if (e.data.size > 0) {
          await transcribe(e.data, groq); //` Call transcription function
        }
      };

      // Start recording with a timeslice of 3000ms (3 seconds)
      arecorder.current.start(3000);

      // Restart the recorder every 3 seconds
      const interval = setInterval(() => {
        if (arecorder.current && arecorder.current.state === "recording") {
          arecorder.current.stop();
          arecorder.current.start(3000);
        }
      }, 3000);

      // Cleanup interval on unmount
      return () => clearInterval(interval);
    }
  }, [stream]);

  // Effect to handle real-time analysis of the transcript
  useEffect(() => {
    const analyzeTranscript = async () => {
      if (transcript) {
        // Extract the last 5 sentences from the transcript
        const sentences = transcript.match(/[^.!?]+[.!?]+/g);
        if (sentences) {
          const lastFiveSentences = sentences.slice(-5).join(" ").trim();
          try {
            setLoading(true);
            const response = await axios.post<AnalysisResponse>("http://127.0.0.1:5000/analyze", {
              statement: lastFiveSentences,
            });
            setAnalysis(response.data.analysis);
            setSources(response.data.sources);
          } catch (error) {
            console.error("Error analyzing transcript:", error);
            setAnalysis("An error occurred while analyzing the transcript.");
            setSources([]);
          } finally {
            setLoading(false);
          }
        }
      }
    };

    // Analyze the transcript every 10 seconds
    const analysisInterval = setInterval(analyzeTranscript, 10000);
    return () => clearInterval(analysisInterval);
  }, [transcript]);

  // Effect to handle Hume AI WebSocket connection
  useEffect(() => {
    if (stream) {
      // Connect to Hume AI WebSocket
      humeSocket.current = new WebSocket(
        `wss://api.hume.ai/v0/stream/models?apikey=${process.env.REACT_APP_HUME_API_KEY}`
      );

      humeSocket.current.onopen = () => {
        console.log("Connected to Hume AI");
      };

      humeSocket.current.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.face) {
          const emotions = data.face.predictions[0].emotions;
          const scores: EmotionScores = {
            confusion: emotions.find((e: any) => e.name === "Confusion")?.score || 0,
            interest: emotions.find((e: any) => e.name === "Interest")?.score || 0,
            pride: emotions.find((e: any) => e.name === "Pride")?.score || 0,
            determination: emotions.find((e: any) => e.name === "Determination")?.score || 0,
            concentration: emotions.find((e: any) => e.name === "Concentration")?.score || 0,
          };
          setEmotionScores(scores);
        }
      };

      humeSocket.current.onclose = () => {
        console.log("Disconnected from Hume AI");
      };

      
      const captureInterval = setInterval(() => {
        if (videoRef.current && canvasRef.current && humeSocket.current) {
          const canvas = canvasRef.current;
          const context = canvas.getContext("2d");
          if (context) {
            context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
              if (blob) {
                const reader = new FileReader();
                reader.onload = () => {
                  const base64data = reader.result?.toString().split(",")[1];
                  if (base64data) {
                    const message = JSON.stringify({
                      data: base64data,
                      models: { face: {} },
                    });
                    humeSocket.current?.send(message);
                  }
                };
                reader.readAsDataURL(blob);
              }
            }, "image/jpeg");
          }
        }
      }, 1000); // Capture frames every second

      return () => {
        clearInterval(captureInterval);
        if (humeSocket.current) {
          humeSocket.current.close();
        }
      };
    }
  }, [stream]);

  // Function to start screen capture and audio recording
  const startCapture = async () => {
    try {
      const cs = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      setStream(cs); // Set the stream for display
      if (videoRef.current) {
        videoRef.current.srcObject = cs;
      }
    } catch (err) {
      console.error("Error capturing screen:", err);
    }
  };

  // Function to handle transcription using Groq
  const transcribe = async (blob: Blob, groq: Groq) => {
    try {
      const response = await groq.audio.translations.create({
        file: await toFile(blob, "audio.webm"),
        model: "whisper-large-v3",
        prompt: "",
        response_format: "json",
        temperature: 0,
      });

      const newTranscriptText = response.text;

      // Update transcript state
      setTranscript((prevText) => prevText + " " + newTranscriptText);
    } catch (error) {
      console.error("Error transcribing audio:", error);
    }
  };

  // Handle form submission for statement analysis
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await axios.post<AnalysisResponse>("http://127.0.0.1:5000/analyze", {
        statement: statement,
      });

      setAnalysis(response.data.analysis);
      setSources(response.data.sources);
    } catch (error) {
      console.error("Error analyzing statement:", error);
      setAnalysis("An error occurred while analyzing the statement.");
      setSources([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="App">
  <img 
  src="/images/VERITAS.png" 
  alt="Veritas Logo" 
  style={{ maxWidth: "200px", height: "auto" }} 
/>

  <form onSubmit={handleSubmit}>
  <textarea
  value={statement}
  onChange={(e) => setStatement(e.target.value)}
  placeholder="Enter a statement to analyze..."
  rows={5}
  required
  style={{ width: "1000px" }} // Set a wider width
/>
    <br />
    <button 
  type="submit" 
  disabled={loading} 
  style={{ display: "block", margin: "0 auto" }}
>
  {loading ? "Analyzing..." : "Analyze"}
</button>
  </form>

      <div className="result-box">
        <h2>Transcript:</h2>
        <p>{transcript}</p>
      </div>

      <div className="screen-capture">
        <button onClick={startCapture}>Start Screen Capture</button>
        <video
          ref={videoRef}
          autoPlay
          className="video-box"
          style={{ width: "800px", height: "800px" }} // Adjust the size here
        ></video>
        <canvas ref={canvasRef} style={{ display: "none" }} width="640" height="480"></canvas>
      </div>

      {analysis && (
        <div className="result-box">
          <h2>Analysis:</h2>
          <p>{analysis}</p>

          {sources.length > 0 && (
            <>
              <h2>Relevant Sources:</h2>
              <ul>
                {sources.map((url, index) => (
                  <li key={index}>
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ProgressBar component
const ProgressBar: React.FC<{ progress: number }> = ({ progress }) => {
  return (
    <div style={{ width: "100%", backgroundColor: "#e0e0e0", borderRadius: "5px" }}>
      <div
        style={{
          width: `${progress * 100}%`,
          height: "10px",
          backgroundColor: "#76c7c0",
          borderRadius: "5px",
        }}
      ></div>
    </div>
  );
};

export default App;