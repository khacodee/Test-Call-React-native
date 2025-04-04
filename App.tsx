import React, { useEffect, useRef, useState } from "react";
import 'react-native-url-polyfill/auto';
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  Button,
  StyleSheet,
  TouchableOpacity,
  Alert,
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

        requestPermissions();

      newConnection.start().catch((err) => console.error("SignalR Connection Error: ", err));

      newConnection.on("ReceiveOffer", async (offer, callerUserId) => {
  console.log("Incoming call from:", callerUserId);
  setIncomingCall({ callerUserId, offer });
  setTargetUserId(callerUserId);
  if (!peer.current) {
    await setupWebRTC();
  }
});

      newConnection.on("ReceiveAnswer", async (answer) => {
        await peer.current.setRemoteDescription(new RTCSessionDescription(JSON.parse(answer)));
      });

      newConnection.on("ReceiveIceCandidate", (candidate) => {
        const iceCandidate = new RTCIceCandidate(JSON.parse(candidate));
        if (peer.current && peer.current.remoteDescription) {
          peer.current.addIceCandidate(iceCandidate);
        } else {
          iceCandidateQueue.current.push(iceCandidate);
        }
      });

      newConnection.on("CallEnded", () => {
        endCall();
      });

      setConnection(newConnection);
      return () => newConnection.stop();
    }
  }, [isLoggedIn, userId]);

  const setupWebRTC = async () => {
  try {
    console.log("Setting up WebRTC");
    peer.current = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        {
          urls: "turn:openrelay.metered.ca:80",
          username: "openrelayproject",
          credential: "openrelayproject",
        },
      ],
    });

    peer.current.onicecandidate = async (event) => {
      if (event.candidate && targetUserId) {
        console.log("Sending ICE candidate");
        connection.invoke("SendIceCandidate", targetUserId, JSON.stringify(event.candidate));
      }
    };

    peer.current.ontrack = (event) => {
      console.log("Receiving remote track");
      if (remoteStreamRef.current) {
        remoteStreamRef.current.srcObject = event.streams[0];
      }
    };

    const stream = await mediaDevices.getUserMedia({ video: true, audio: true });
    if (localStreamRef.current) {
      localStreamRef.current.srcObject = stream;
    }
    stream.getTracks().forEach((track) => peer.current.addTrack(track, stream));
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
    await setupWebRTC();
    const offer = await peer.current.createOffer();
    await peer.current.setLocalDescription(offer);
    connection.invoke("SendOffer", targetUserId, JSON.stringify(offer));
  };

  const endCall = () => {
    if (peer.current) {
      peer.current.close();
      peer.current = null;
    }
    localStreamRef.current.srcObject = null;
    remoteStreamRef.current.srcObject = null;
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
    while (iceCandidateQueue.current.length > 0) {
      const candidate = iceCandidateQueue.current.shift();
      await peer.current.addIceCandidate(candidate);
      console.log("Added ICE candidate");
    }
    const answer = await peer.current.createAnswer();
    await peer.current.setLocalDescription(answer);
    console.log("Local description set");
    connection.invoke("SendAnswer", incomingCall.callerUserId, JSON.stringify(answer))
      .then(() => console.log("Answer sent successfully"))
      .catch((error) => console.error("Error sending answer:", error));
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
    const audioTracks = localStreamRef.current.srcObject.getAudioTracks();
    if (audioTracks.length > 0) {
      const isEnabled = audioTracks[0].enabled;
      audioTracks[0].enabled = !isEnabled;
      setIsMicOn(!isEnabled);
    }
  };

  const toggleVideo = () => {
    const videoTracks = localStreamRef.current.srcObject.getVideoTracks();
    if (videoTracks.length > 0) {
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
            value={userId}
            onChangeText={setUserId}
          />
          <Button title="Login" onPress={() => setIsLoggedIn(true)} />
        </View>
      ) : (
        <View style={styles.callContainer}>
         <RTCView
  ref={localStreamRef}
  streamURL={localStreamRef.current?.srcObject?.toURL()}
  style={styles.video}
/>
<RTCView
  ref={remoteStreamRef}
  streamURL={remoteStreamRef.current?.srcObject?.toURL()}
  style={styles.video}
/>
          <TextInput
            style={styles.input}
            placeholder="Enter Target User ID"
            value={targetUserId}
            onChangeText={setTargetUserId}
          />
          <Button title="Start Call" onPress={startCall} />
          <Button title="End Call" onPress={endCall} />
          <TouchableOpacity onPress={toggleMic}>
            <Text>{isMicOn ? "Mic On" : "Mic Off"}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={toggleVideo}>
            <Text>{isVideoOn ? "Video On" : "Video Off"}</Text>
          </TouchableOpacity>
          {incomingCall && (
            <View>
              <Text>Incoming Call from: {incomingCall.callerUserId}</Text>
              <Button title="Accept" onPress={acceptCall} />
              <Button title="Reject" onPress={rejectCall} />
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
    padding: 16,
  },
  loginContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  callContainer: {
    flex: 1,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    padding: 8,
    marginVertical: 8,
  },
  video: {
    width: "100%",
    height: 200,
    backgroundColor: "#000",
  },
  title: {
    fontSize: 24,
    marginBottom: 16,
  },
});

export default App;