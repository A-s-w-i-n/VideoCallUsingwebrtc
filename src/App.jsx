import io from "socket.io-client";
import { useRef, useState, useEffect, useCallback } from "react";
import { FiVideo, FiVideoOff, FiMic, FiMicOff } from "react-icons/fi";
import "./App.css";

const configuration = {
  iceServers: [
    {
      urls: "stun:stun.l.google.com:19302",
    },
  ],
  iceCandidatePoolSize: 10,
};

// http://localhost:5000
// https://videocall-backend-wqwv.onrender.com
const socket = io("https://videocall-backend-wqwv.onrender.com", {
  transports: ["websocket"],
});

function App() {
  const [roomId, setRoomId] = useState("");
  const [isInRoom, setIsInRoom] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [localStream, setLocalStream] = useState(null);
  const localVideoRef = useRef(null);
  const remoteVideosRef = useRef({});
  const [users, setUsers] = useState([]);
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
          console.log(localVideoRef);
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = localStream;
            clearInterval(interval);
          }
        }, 100);
      }
    }
  }, [localStream]);

  useEffect(() => {
    socket.on("roomUsers", handleRoomUsers);
    return () => {
      socket.off("roomUsers", handleRoomUsers);
    };
  }, []);

  const handleRoomUsers = async (users) => {
    const updatedUsers = users.map((userId) => ({
      id: userId,
      stream: userId === socket.id ? localStream : null,
      isLocalUser: userId === socket.id,
    }));
    setUsers(updatedUsers);

    for (const userId of users) {
      if (!pcsRef.current[userId]) {
        await createPeerConnection(userId);

        // Ensure an offer is created and sent when joining the room
        if (isInRoom && userId !== socket.id) {
          const offer = await pcsRef.current[userId].createOffer();
          await pcsRef.current[userId].setLocalDescription(offer);
          socket.emit("message", {
            type: "offer",
            sdp: offer.sdp,
            from: socket.id,
            roomId,
            to: userId,
          });
        }

        // Create and append video element for the remote user
        // if (!remoteVideosRef.current[userId]) {
        //   const video = document.createElement("video");
        //   video.autoplay = true;
        //   video.playsInline = true;
        //   video.className = "remote-video";
        //   remoteVideosRef.current[userId] = video;
        //   const remoteVideosContainer = document.querySelector(".remote-videos");
        //   if (remoteVideosContainer) {
        //     remoteVideosContainer.appendChild(video);
        //   }
        // }
      }

      // Update the remote user's stream
      const remoteVideo = remoteVideosRef.current[userId];
      if (remoteVideo) {
        remoteVideo.srcObject = pcsRef.current[userId]?.remoteStream;
      }
    }

    // Update the local user's stream after creating peer connections
    setUsers((prevUsers) =>
      prevUsers.map((user) =>
        user.id !== socket.id
          ? { ...user, stream: pcsRef.current[user.id]?.remoteStream }
          : { ...user, stream: localStream }
      )
    );
  };
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


    console.log(pcsRef.current);
    


    if (!pcsRef.current[userId]) {
      console.log("hiiiiiii");

      await createPeerConnection(userId);
      if (isInRoom) {
        console.log("jiii");
        
        console.log(isInRoom);

        const offer = await pcsRef.current[userId].createOffer();
        await pcsRef.current[userId].setLocalDescription(offer);
        socket.emit("message", {
          type: "offer",
          sdp: offer.sdp,
          from: socket.id,
          roomId,
          to: userId, 
        });
      }
    }
    

    setUsers((prevUsers) => [
      ...prevUsers,
      { id: userId, stream: pcsRef.current[userId]?.remoteStream || null },
    ]);
    console.log("hiiii");

  };

  const handleUserLeft = (userId) => {
    console.log(`User ${userId} left the room`);
    if (pcsRef.current[userId]) {
      pcsRef.current[userId].close();
      delete pcsRef.current[userId];
    }
    if (remoteVideosRef.current[userId]) {
      const video = remoteVideosRef.current[userId];
      video.srcObject = null;
      video.remove();
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
    const pc = new RTCPeerConnection(configuration);

    pc.ontrack = (e) => {
      const remoteStream = e.streams[0];
      console.log(remoteStream, "checking");

      setUsers((prevUsers) =>
        prevUsers.map((user) =>
          user.id === userId ? { ...user, stream: remoteStream } : user
        )
      );

      // Create and append video element if not already present
      if (!remoteVideosRef.current[userId]) {
        const video = document.createElement("video");
        video.srcObject = remoteStream;
        video.autoplay = true;
        video.playsInline = true;
        video.className = "remote-video";
        remoteVideosRef.current[userId] = video;
        const remoteVideosContainer = document.querySelector(".remote-videos");
        if (remoteVideosContainer) {
          remoteVideosContainer.appendChild(video);
        }
      } else {
        remoteVideosRef.current[userId].srcObject = remoteStream;
      }
    };

    if (localStream) {
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });
    }
    pcsRef.current[userId] = pc;
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
  console.log(localStream);

  const startLocalStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: true,
      });
      console.log(stream);

      setLocalStream(stream);
      setUsers((prevUsers) => [...prevUsers, { id: socket.id, stream }]);
    } catch (err) {
      console.error("Error accessing media devices:", err);
    }
  }, []);

  const createRoom = useCallback(async () => {
    await startLocalStream();
    console.log(roomId,"");
    
    socket.emit("createRoom", roomId);
  }, [roomId, startLocalStream]);

  const joinRoom = useCallback(async () => {
    await startLocalStream();
    console.log(roomId,"roomid");
    
    socket.emit("joinRoom", roomId);
    setIsInRoom(true);
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
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100">
      <h1 className="text-2xl font-bold mb-4">Video Call App</h1>
      {!isInRoom ? (
        <div className="flex flex-col items-center space-y-4">
          <input
            type="text"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            placeholder="Enter Room ID"
            className="p-2 border rounded-md"
          />
          <div className="flex space-x-4">
            <button
              onClick={createRoom}
              className="px-4 py-2 bg-blue-500 text-white rounded-md"
            >
              Create Room
            </button>
            <button
              onClick={joinRoom}
              className="px-4 py-2 bg-green-500 text-white rounded-md"
            >
              Join Room
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center space-y-4">
          <div className="remote-videos bg-black grid grid-cols-1 md:grid-cols-3 gap-4">
            {users
              .filter((user) => user.id !== socket.id && user.stream)
 
              .map(
                (user) => (
                  console.log(user),
                  (
                    <video
                      key={user.id}
                      autoPlay 
                      playsInline
                      className="w-full h-auto rounded-md"
                      // eslint-disable-next-line react/no-unknown-property
                      // srcObject ={user.stream} 
                      ref={(el) => { 
                        if (el) {
                          el.srcObject = user.stream; 
                        }
                      }} 
                    />
                  )   
                )
              )}
          </div>
          {localStream && (
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-64 h-auto rounded-md self-center"
              // eslint-disable-next-line react/no-unknown-property
              srcObject={localStream}
            />
          )}
          <div className="flex space-x-4 mt-4">
            <button
              onClick={toggleAudio}
              className="p-2 bg-gray-800 text-white rounded-full"
            >
              {audioEnabled ? <FiMic /> : <FiMicOff />}
            </button>
            <button
              onClick={toggleVideo}
              className="p-2 bg-gray-800 text-white rounded-full"
            >
              {videoEnabled ? <FiVideo /> : <FiVideoOff />}
            </button>
            <button
              onClick={leaveRoom}
              className="px-4 py-2 bg-red-500 text-white rounded-md"
            >
              Leave Room
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
