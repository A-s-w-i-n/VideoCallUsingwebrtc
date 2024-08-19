import io from 'socket.io-client';
import { useRef, useState, useEffect } from 'react';
import { FiVideo, FiVideoOff, FiMic, FiMicOff } from 'react-icons/fi';
import './App.css';

const configuration = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 10,
};

const socket = io('http://localhost:5000', { transports: ['websocket'] });

let pcs = {};
let localStream;
let startButton;
let hangupButton;
let muteButton;
let localVideo;
let remoteVideos = {};

socket.on('message', async (message) => {
  if (!localStream) {
    console.log('Stream not ready');
    return;
  }

  switch (message.type) {
    case 'offer':
      await handleOffer(message);
      break;
    case 'answer':
      await handleAnswer(message);
      break;
    case 'candidate':
      await handleCandidate(message);
      break;
    case 'ready':
      if (pcs[message.roomId]) {
        console.log('Already in call, ignoring');
        return;
      }
      await makeCall(message.roomId);
      break;
    case 'bye':
      if (pcs[message.roomId]) {
        await hangup(message.roomId);
      }
      break;
    default:
      console.log('Unhandled message', message);
      break;
  }
});

async function makeCall(roomId) {
  try {
    pcs[roomId] = new RTCPeerConnection(configuration);
    pcs[roomId].onicecandidate = (e) => {
      const message = {
        type: 'candidate',
        candidate: e.candidate ? e.candidate.candidate : null,
        sdpMid: e.candidate ? e.candidate.sdpMid : null,
        sdpMLineIndex: e.candidate ? e.candidate.sdpMLineIndex : null,
        roomId,
      };
      socket.emit('message', message);
    };
    pcs[roomId].ontrack = (e) => {
      if (!remoteVideos[roomId]) {
        remoteVideos[roomId] = document.createElement('video');
        remoteVideos[roomId].className = 'video-item';
        remoteVideos[roomId].autoplay = true;
        remoteVideos[roomId].playsInline = true;
        document.querySelector('.video.bg-main').appendChild(remoteVideos[roomId]);
      }
      remoteVideos[roomId].srcObject = e.streams[0];
    };
    localStream.getTracks().forEach((track) => pcs[roomId].addTrack(track, localStream));
    const offer = await pcs[roomId].createOffer();
    await pcs[roomId].setLocalDescription(offer);
    socket.emit('message', { type: 'offer', sdp: offer.sdp, roomId });
  } catch (err) {
    console.error('Error in makeCall:', err);
  }
}

async function handleOffer(offer) {
  if (pcs[offer.roomId]) {
    console.error('Existing peer connection for room:', offer.roomId);
    return;
  }
  try {
    pcs[offer.roomId] = new RTCPeerConnection(configuration);
    pcs[offer.roomId].onicecandidate = (e) => {
      const message = {
        type: 'candidate',
        candidate: e.candidate ? e.candidate.candidate : null,
        sdpMid: e.candidate ? e.candidate.sdpMid : null,
        sdpMLineIndex: e.candidate ? e.candidate.sdpMLineIndex : null,
        roomId: offer.roomId,
      };
      socket.emit('message', message);
    };
    pcs[offer.roomId].ontrack = (e) => {
      if (!remoteVideos[offer.roomId]) {
        remoteVideos[offer.roomId] = document.createElement('video');
        remoteVideos[offer.roomId].className = 'video-item';
        remoteVideos[offer.roomId].autoplay = true;
        remoteVideos[offer.roomId].playsInline = true;
        document.querySelector('.video.bg-main').appendChild(remoteVideos[offer.roomId]);
      }
      remoteVideos[offer.roomId].srcObject = e.streams[0];
    };
    localStream.getTracks().forEach((track) => pcs[offer.roomId].addTrack(track, localStream));
    await pcs[offer.roomId].setRemoteDescription({ type: 'offer', sdp: offer.sdp });

    const answer = await pcs[offer.roomId].createAnswer();
    await pcs[offer.roomId].setLocalDescription(answer);
    socket.emit('message', { type: 'answer', sdp: answer.sdp, roomId: offer.roomId });
  } catch (error) {
    console.error('Error in handleOffer:', error);
  }
}

async function handleAnswer(answer) {
  if (!pcs[answer.roomId]) {
    console.error('No peer connection for room:', answer.roomId);
    return;
  }
  try {
    await pcs[answer.roomId].setRemoteDescription(answer);
  } catch (err) {
    console.error('Error in handleAnswer:', err);
  }
}

async function handleCandidate(candidate) {
  try {
    if (!pcs[candidate.roomId]) {
      console.error('No peer connection for room:', candidate.roomId);
      return;
    }
    if (candidate.candidate) {
      await pcs[candidate.roomId].addIceCandidate(new RTCIceCandidate(candidate));
    }
  } catch (err) {
    console.error('Error in handleCandidate:', err);
  }
}

async function hangup(roomId) {
  if (pcs[roomId]) {
    pcs[roomId].close();
    delete pcs[roomId];
  }
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
  }
  localStream = null;
  if (startButton.current) startButton.current.disabled = false;
  if (hangupButton.current) hangupButton.current.disabled = true;
  if (muteButton.current) muteButton.current.disabled = true;
}

function App() {
  startButton = useRef(null);
  hangupButton = useRef(null);
  muteButton = useRef(null);
  localVideo = useRef(null);

  useEffect(() => {
    if (hangupButton.current) hangupButton.current.disabled = true;
    if (muteButton.current) muteButton.current.disabled = true;
  }, []);

  const [audiostate, setAudio] = useState(false);
  const [roomId, setRoomId] = useState('');

  const startB = async () => {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: { echoCancellation: true },
      });
      
      if (localVideo.current) localVideo.current.srcObject = localStream;
      console.log('Local stream started:', localStream);
    } catch (err) {
      console.error('Error accessing media devices:', err);
      return;
    }
    if (startButton.current) startButton.current.disabled = true;
    if (hangupButton.current) hangupButton.current.disabled = false;
    if (muteButton.current) muteButton.current.disabled = false;

    socket.emit('message', { type: 'ready', roomId });
  };

  const joinRoom = () => {
    socket.emit('joinRoom', roomId);
    startB();
  };

  const hangB = async () => {
    await hangup(roomId);
    socket.emit('message', { type: 'bye', roomId });
  };

  function muteAudio() {
    if (localStream) {
      const enabled = localStream.getAudioTracks()[0].enabled;
      localStream.getAudioTracks()[0].enabled = !enabled;
      setAudio(!enabled);
    }
  }

  return (
    <>
      <main className="container">
        <div className="video bg-main">
          <video
            ref={localVideo}
            className="video-item"
            autoPlay
            playsInline
          ></video>
        </div>
        <div className="controls">
          <button
            ref={startButton}
            className="btn"
            onClick={startB}
          >
            <FiVideo /> Start
          </button>
          <button
            ref={hangupButton}
            className="btn"
            onClick={hangB}
          >
            <FiVideoOff /> Hang Up
          </button>
          <button
            ref={muteButton}
            className="btn"
            onClick={muteAudio}
          >
            {audiostate ? <FiMic /> : <FiMicOff />} {audiostate ? 'Mute' : 'Unmute'}
          </button>
        </div>
        <input
          type="text"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          placeholder="Enter Room ID"
        />
        <button onClick={joinRoom}>Join Room</button>
      </main>
    </>
  );
}

export default App;
