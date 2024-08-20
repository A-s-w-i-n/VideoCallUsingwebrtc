import io from "socket.io-client";
import {
  useRef,
  useState,
  useEffect,
  useCallback,
} from "react";
import { FiVideo, FiVideoOff, FiMic, FiMicOff } from "react-icons/fi";
import "./App.css";

const configuration = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
    },
  ],
  iceCandidatePoolSize: 10,
};

const socket = io("http://localhost:5000", { transports: ["websocket"] });

function App() {
  const [roomId, setRoomId] = useState("");
  const [isInRoom, setIsInRoom] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [localStream, setLocalStream] = useState(null);
  const localVideoRef = useRef(null);
  const remoteVideosRef = useRef({});
  const pcsRef = useRef({});

  useEffect(() => {
    socket.on("message", handleMessage);
    socket.on("userJoined", handleUserJoined);
    socket.on("userLeft", handleUserLeft);
    socket.on("roomCreated", handleRoomCreated);
    socket.on("roomJoined", handleRoomJoined);
    socket.on("roomError", handleRoomError);

    return () => {
      socket.off("message", handleMessage);
      socket.off("userJoined", handleUserJoined);
      socket.off("userLeft", handleUserLeft);
      socket.off("roomCreated", handleRoomCreated);
      socket.off("roomJoined", handleRoomJoined);
      socket.off("roomError", handleRoomError);
    };
  }, []);

  useEffect(() => {
    if (localStream) {
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
      } else {
        const interval = setInterval(() => {
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = localStream;
            clearInterval(interval);
          }
        }, 100);
      }
    }
  }, [localStream]);

  const handleMessage = async (message) => {
    switch (message.type) {
      case "offer":
        await handleOffer(message);
        break;
      case "answer":
        await handleAnswer(message);
        break;
      case "candidate":
        await handleCandidate(message);
        break;
      default:
        console.log("Unhandled message", message);
        break;
    }
  };

  const handleUserJoined = async (userId) => {
    console.log(`User ${userId} joined the room`);
    await createPeerConnection(userId);
    if (pcsRef.current[userId]) {
      const offer = await pcsRef.current[userId].createOffer();
      await pcsRef.current[userId].setLocalDescription(offer);
      socket.emit("message", {
        type: "offer",
        sdp: offer.sdp,
        from: socket.id, // send your socket id as the "from" field
        roomId,
        to: userId,
      });
    }
  };

  const handleUserLeft = (userId) => {
    console.log(`User ${userId} left the room`);
    if (pcsRef.current[userId]) {
      pcsRef.current[userId].close();
      delete pcsRef.current[userId];
    }
    if (remoteVideosRef.current[userId]) {
      remoteVideosRef.current[userId].remove();
      delete remoteVideosRef.current[userId];
    }
  };

  const handleRoomCreated = (createdRoomId) => {
    console.log(`Room ${createdRoomId} created`);
    setIsInRoom(true);
  };

  const handleRoomJoined = (joinedRoomId) => {
    console.log(`Joined room ${joinedRoomId}`);
    setIsInRoom(true);
  };

  const handleRoomError = (error) => {
    console.error("Room error:", error);
    alert(error);
  };

  const createPeerConnection = async (userId) => {
    pcsRef.current[userId] = new RTCPeerConnection(configuration);
    pcsRef.current[userId].onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit("message", {
          type: "candidate",
          candidate: e.candidate,
          from: socket.id,
          roomId,
          to: userId,
        });
      }
    };
    pcsRef.current[userId].ontrack = (e) => {
      if (!remoteVideosRef.current[userId]) {
        const video = document.createElement("video");
        video.srcObject = e.streams[0];
        video.autoplay = true;
        video.playsInline = true;
        video.className = "remote-video";
        remoteVideosRef.current[userId] = video;
        document.querySelector(".remote-videos").appendChild(video);
      }
    };
    if (localStream) {
      localStream.getTracks().forEach((track) =>
        pcsRef.current[userId].addTrack(track, localStream)
      );
    }
  };

  const handleOffer = async (offer) => {
    if (!pcsRef.current[offer.from]) {
      await createPeerConnection(offer.from);
    }
    await pcsRef.current[offer.from].setRemoteDescription(
      new RTCSessionDescription({ type: "offer", sdp: offer.sdp })
    );
    const answer = await pcsRef.current[offer.from].createAnswer();
    await pcsRef.current[offer.from].setLocalDescription(answer);
    socket.emit("message", {
      type: "answer",
      sdp: answer.sdp,
      from: socket.id,
      roomId,
      to: offer.from,
    });
  };

  const handleAnswer = async (answer) => {
    await pcsRef.current[answer.from].setRemoteDescription(
      new RTCSessionDescription({ type: "answer", sdp: answer.sdp })
    );
  };

  const handleCandidate = async (candidate) => {
    await pcsRef.current[candidate.from].addIceCandidate(
      new RTCIceCandidate(candidate.candidate)
    );
  };

  const startLocalStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: true,
      });
      setLocalStream(stream);
    } catch (err) {
      console.error("Error accessing media devices:", err);
    }
  }, []);

  const createRoom = useCallback(async () => {
    await startLocalStream();
    socket.emit("createRoom", roomId);
  }, [roomId, startLocalStream]);

  const joinRoom = useCallback(async () => {
    await startLocalStream();
    socket.emit("joinRoom", roomId);
  }, [roomId, startLocalStream]);

  const leaveRoom = () => {
    socket.emit("leaveRoom", roomId);
    Object.values(pcsRef.current).forEach((pc) => pc.close());
    pcsRef.current = {};
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    setLocalStream(null);
    remoteVideosRef.current = {};
    setIsInRoom(false);
  };

  const toggleAudio = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioEnabled;
        setAudioEnabled(!audioEnabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoEnabled;
        setVideoEnabled(!videoEnabled);
      }
    }
  };

  return (
    <div className="app">
      <h1>Video Call App</h1>
      {!isInRoom ? (
        <div className="room-controls">
          <input
            type="text"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            placeholder="Enter Room ID"
          />
          <button onClick={createRoom}>Create Room</button>
          <button onClick={joinRoom}>Join Room</button>
        </div>
      ) : (
        <div className="video-chat">
          <div className="local-video-container">
            {localStream && (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="local-video"
              />
            )}
          </div>
          <div className="remote-videos"></div>
          <div className="controls">
            <button onClick={toggleAudio}>
              {audioEnabled ? <FiMic /> : <FiMicOff />}
            </button>
            <button onClick={toggleVideo}>
              {videoEnabled ? <FiVideo /> : <FiVideoOff />}
            </button>
            <button onClick={leaveRoom}>Leave Room</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
