import React, { useEffect, useRef, useState } from "react";
import 'react-native-url-polyfill/auto';
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
  PermissionsAndroid,
} from "react-native";
import { RTCPeerConnection, RTCView, mediaDevices, RTCSessionDescription } from "react-native-webrtc";
import * as signalR from "@microsoft/signalr";

const SERVER_URL = "https://tellory.id.vn/callhub";

const App = () => {
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const peer = useRef(null);
  const [connection, setConnection] = useState(null);
  const [targetUserId, setTargetUserId] = useState("");
  const [userId, setUserId] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null);
  const iceCandidateQueue = useRef([]);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isVideoOn, setIsVideoOn] = useState(true);

  const requestPermissions = async () => {
    if (Platform.OS === "android") {
      try {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.CAMERA,
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        ]);

        if (
          granted[PermissionsAndroid.PERMISSIONS.CAMERA] !== PermissionsAndroid.RESULTS.GRANTED ||
          granted[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] !== PermissionsAndroid.RESULTS.GRANTED
        ) {
          Alert.alert("Permissions Denied", "Camera and Audio permissions are required.");
        }
      } catch (err) {
        console.warn(err);
      }
    }
  };
useEffect(() => {
    if (isLoggedIn) {
      const newConnection = new signalR.HubConnectionBuilder()
        .withUrl(`${SERVER_URL}?userId=${encodeURIComponent(userId)}`)
        .withAutomaticReconnect()
        .build();

      newConnection.start()
        .then(() => {
          console.log("SignalR connected");
        })
        .catch((err) => console.error("SignalR Connection Error: ", err));

      // Handle incoming offer
      newConnection.on("ReceiveOffer", async (offer, callerUserId) => {
        console.log("Incoming call from:", callerUserId);
        setIncomingCall({ callerUserId, offer });
        setTargetUserId(callerUserId);
        if (!peer.current) {
          await setupWebRTC();
        }
      });

      // Handle incoming answer
      newConnection.on("ReceiveAnswer", async (answer) => {
        console.log("Received answer");
        await peer.current.setRemoteDescription(new RTCSessionDescription(JSON.parse(answer)));
      });

      // Handle incoming ICE candidates
      newConnection.on("ReceiveIceCandidate", (candidate) => {
        console.log("Received ICE candidate");
        const iceCandidate = new RTCIceCandidate(JSON.parse(candidate));
        if (peer.current && peer.current.remoteDescription) {
          peer.current.addIceCandidate(iceCandidate);
        } else {
          iceCandidateQueue.current.push(iceCandidate);
        }
      });

      // Handle call ended
      newConnection.on("CallEnded", () => {
        console.log("Call ended");
        endCall();
      });

      setConnection(newConnection);

      return () => {
        newConnection.stop();
      };
    }
  }, [isLoggedIn, userId]);
  
  const setupWebRTC = async () => {
    try {
      console.log("Setting up WebRTC...");
      peer.current = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          {
            urls: "turn:tellory.id.vn:3478",
            username: "sep2025",
            credential: "sep2025",
          },
        ],
        iceTransportPolicy: "all",
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
  iceCandidatePoolSize: 0,
      });

      const checkUserExists = async (userId) => {
  try {
    const userExists = await connection.invoke("CheckUserExists", userId);
    console.log(`User ${userId} exists: ${userExists}`);
    return userExists;
  } catch (error) {
    console.error("Error checking user existence:", error);
    return false;
  }
};

      peer.current.onicecandidate = async (event) => {
  if (event.candidate && targetUserId) {
    console.log("Generated ICE candidate:", event.candidate);

    const userExists = await checkUserExists(targetUserId);
    if (!userExists) {
      console.warn(`Không thể gửi ICE candidate. User ${targetUserId} không kết nối.`);
      return;
    }

    console.log("Gửi ICE candidate đến:", targetUserId);
    connection.invoke("SendIceCandidate", targetUserId, JSON.stringify(event.candidate))
      .catch(err => console.error("Lỗi khi gửi ICE candidate:", err));
  } else {
    console.warn("ICE candidate không được gửi: targetUserId chưa được thiết lập.");
  }
};

peer.current.ontrack = (event) => {
  console.log("Remote track received:", event.streams[0]);
  if (remoteStreamRef.current) {
    remoteStreamRef.current.srcObject = event.streams[0];
  }
};

      const stream = await mediaDevices.getUserMedia({ video: true, audio: true });
      console.log("Audio tracks:", stream.getAudioTracks());
      if (localStreamRef.current) {
        localStreamRef.current.srcObject = stream;
      }
      stream.getTracks().forEach((track) => peer.current.addTrack(track, stream));
      console.log("Local stream set up successfully");
    } catch (error) {
      console.error("Error in setupWebRTC:", error);
      Alert.alert("Error", "Unable to set up WebRTC: " + error.message);
    }
  };

  const startCall = async () => {
    if (!targetUserId) {
      Alert.alert("Error", "Please enter a target user ID.");
      return;
    }
    try {
      console.log("Starting call...");
      await setupWebRTC();
      const offer = await peer.current.createOffer();
      await peer.current.setLocalDescription(offer);
      console.log("Local description set with offer");
      connection.invoke("SendOffer", targetUserId, JSON.stringify(offer));
    } catch (error) {
      console.error("Error in startCall:", error);
      Alert.alert("Error", "Failed to start the call: " + error.message);
    }
  };

  const endCall = () => {
    if (peer.current) {
      peer.current.close();
      peer.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.srcObject = null;
    }
    if (remoteStreamRef.current) {
      remoteStreamRef.current.srcObject = null;
    }
    if (connection && targetUserId) {
      connection.invoke("EndCall", targetUserId);
    }
  };

  const acceptCall = async () => {
    console.log("Accept Call button pressed");
    try {
      await setupWebRTC();
      console.log("WebRTC setup completed");
      await peer.current.setRemoteDescription(new RTCSessionDescription(JSON.parse(incomingCall.offer)));
      console.log("Remote description set");
      const answer = await peer.current.createAnswer();
      await peer.current.setLocalDescription(answer);
      console.log("Local description set");
      connection.invoke("SendAnswer", incomingCall.callerUserId, JSON.stringify(answer));
      setIncomingCall(null);
    } catch (error) {
      console.error("Error in acceptCall:", error);
      Alert.alert("Error", "Failed to accept the call: " + error.message);
    }
  };

  const rejectCall = () => {
    setIncomingCall(null);
  };

  const toggleMic = () => {
    const audioTracks = localStreamRef.current?.srcObject?.getAudioTracks();
    if (audioTracks && audioTracks.length > 0) {
      const isEnabled = audioTracks[0].enabled;
      console.log("Mic is currently:", isEnabled ? "On" : "Off");
      audioTracks[0].enabled = !isEnabled;
      setIsMicOn(!isEnabled);
    }
  };

  const toggleVideo = () => {
    const videoTracks = localStreamRef.current?.srcObject?.getVideoTracks();
    if (videoTracks && videoTracks.length > 0) {
      const isEnabled = videoTracks[0].enabled;
      videoTracks[0].enabled = !isEnabled;
      setIsVideoOn(!isEnabled);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {!isLoggedIn ? (
        <View style={styles.loginContainer}>
          <Text style={styles.title}>Login</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter User ID"
            placeholderTextColor="#aaa"
            value={userId}
            onChangeText={setUserId}
          />
          <TouchableOpacity style={styles.loginButton} onPress={() => setIsLoggedIn(true)}>
            <Text style={styles.loginButtonText}>Login</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.callContainer}>
          <RTCView
            ref={remoteStreamRef}
            streamURL={remoteStreamRef.current?.srcObject?.toURL()}
            style={styles.remoteVideo}
          />
          <RTCView
            ref={localStreamRef}
            streamURL={localStreamRef.current?.srcObject?.toURL()}
            style={styles.localVideo}
          />
          <TextInput
            style={styles.input}
            placeholder="Enter Target User ID"
            placeholderTextColor="#aaa"
            value={targetUserId}
            onChangeText={setTargetUserId}
          />
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.actionButton} onPress={toggleMic}>
              <Text style={styles.actionButtonText}>{isMicOn ? "Mic On" : "Mic Off"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionButton} onPress={toggleVideo}>
              <Text style={styles.actionButtonText}>{isVideoOn ? "Video On" : "Video Off"}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.startButton} onPress={startCall}>
              <Text style={styles.startButtonText}>Start Call</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.endButton} onPress={endCall}>
              <Text style={styles.endButtonText}>End Call</Text>
            </TouchableOpacity>
          </View>
          {incomingCall && (
            <View style={styles.incomingCallContainer}>
              <Text style={styles.incomingCallText}>Incoming Call from: {incomingCall.callerUserId}</Text>
              <TouchableOpacity style={styles.acceptButton} onPress={acceptCall}>
                <Text style={styles.acceptButtonText}>Accept</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.rejectButton} onPress={rejectCall}>
                <Text style={styles.rejectButtonText}>Reject</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#121212", // Dark mode
  },
  loginContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#ffffff",
    marginBottom: 30,
  },
  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#888",
    borderRadius: 10,
    padding: 12,
    color: "#fff",
    backgroundColor: "#1e1e1e",
    marginBottom: 20,
  },
  loginButton: {
    backgroundColor: "#3B82F6", // Blue
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  loginButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  callContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#000",
  },
  remoteVideo: {
    width: "100%",
    height: "100%",
    position: "absolute",
    top: 0,
    left: 0,
  },
  localVideo: {
    width: 120,
    height: 180,
    position: "absolute",
    bottom: 20,
    right: 20,
    backgroundColor: "#000",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#fff",
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    width: "90%",
    marginTop: 10,
  },
  actionButton: {
    backgroundColor: "#2D2D2D",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  actionButtonText: {
    color: "#fff",
    fontSize: 14,
  },
  startButton: {
    backgroundColor: "#22C55E", // Green
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    marginHorizontal: 5,
  },
  startButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  endButton: {
    backgroundColor: "#EF4444", // Red
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    marginHorizontal: 5,
  },
  endButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  incomingCallContainer: {
    position: "absolute",
    top: 50,
    alignSelf: "center",
    backgroundColor: "#1F2937",
    padding: 20,
    borderRadius: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#3B82F6",
  },
  incomingCallText: {
    color: "#fff",
    fontSize: 16,
    marginBottom: 10,
  },
  acceptButton: {
    backgroundColor: "#22C55E",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginBottom: 10,
  },
  acceptButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "bold",
  },
  rejectButton: {
    backgroundColor: "#EF4444",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  rejectButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "bold",
  },
});


export default App;