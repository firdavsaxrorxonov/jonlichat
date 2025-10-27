import React, { useState, useEffect, useRef } from "react";
import { auth, db } from "./firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "firebase/auth";
import {
  ref,
  set,
  onValue,
  remove,
  push,
  get,
  onDisconnect,
  off,
  onChildAdded
} from "firebase/database";

export default function App() {
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [onlineUsers, setOnlineUsers] = useState({});
  const [inQueue, setInQueue] = useState(false);
  const [roomId, setRoomId] = useState(null);
  const [role, setRole] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [partnerName, setPartnerName] = useState("");

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);

  const configuration = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

  // --- Auth & presence ---
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (usr) => {
      setUser(usr);
      if (usr) {
        const onlineRef = ref(db, `online/${usr.uid}`);
        set(onlineRef, { name: name || usr.displayName || "Anon" });
        onDisconnect(onlineRef).remove();
      }
    });
    return unsub;
  }, [name]);

  useEffect(() => {
    const onlineRef = ref(db, "online");
    onValue(onlineRef, (snap) => setOnlineUsers(snap.val() || {}));
  }, []);

  const register = async () => {
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      if (cred.user) await set(ref(db, `users/${cred.user.uid}`), { name });
    } catch (e) { alert(e.message); }
  };

  const login = async () => {
    try { await signInWithEmailAndPassword(auth, email, password); }
    catch (e) { alert(e.message); }
  };

  // --- Queue ---
  const enterQueue = async () => {
    if (!user) return alert("Login qilishingiz kerak");
    const uid = user.uid;
    const myQueueRef = ref(db, `queue/${uid}`);
    await set(myQueueRef, { name: name || user.displayName || "Anon" });
    onDisconnect(myQueueRef).remove();
    setInQueue(true);

    const snap = await get(ref(db, "queue"));
    const queueObj = snap.val() || {};
    const otherUid = Object.keys(queueObj).find(k => k !== uid);
    if (otherUid) {
      const newRoomRef = push(ref(db, "rooms"));
      const rId = newRoomRef.key;
      await set(newRoomRef, { caller: otherUid, callee: uid, createdAt: Date.now() });
      await set(ref(db, `userRooms/${uid}`), rId);
      await set(ref(db, `userRooms/${otherUid}`), rId);
      await remove(ref(db, `queue/${uid}`));
      await remove(ref(db, `queue/${otherUid}`));
      setInQueue(false);
    }
  };

  const leaveQueue = async () => {
    if (!user) return;
    await remove(ref(db, `queue/${user.uid}`));
    setInQueue(false);
  };

  // --- Room listener ---
  useEffect(() => {
    if (!user) return;
    const urRef = ref(db, `userRooms/${user.uid}`);
    const listener = onValue(urRef, async (snap) => {
      const rId = snap.val();
      if (rId) {
        setRoomId(rId);
        const roomSnap = await get(ref(db, `rooms/${rId}`));
        const room = roomSnap.val();
        if (!room) return;
        if (room.caller === user.uid) {
          setRole("caller");
          setPartnerName(onlineUsers[room.callee]?.name || "Unknown");
          joinRoomAsCaller(rId);
        } else if (room.callee === user.uid) {
          setRole("callee");
          setPartnerName(onlineUsers[room.caller]?.name || "Unknown");
          joinRoomAsCallee(rId);
        }
      } else { setRoomId(null); setRole(null); setPartnerName(""); }
    });
    return () => off(urRef);
  }, [user, onlineUsers]);

  // --- WebRTC ---
  const createPC = (rId, isCaller) => {
    const pc = new RTCPeerConnection(configuration);
    pcRef.current = pc;

    if (localStreamRef.current)
      localStreamRef.current.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current));

    pc.ontrack = (e) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = e.streams[0];
        remoteVideoRef.current.play().catch(err => console.warn(err));
      }
    };

    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const side = isCaller ? "callerCandidates" : "calleeCandidates";
      push(ref(db, `rooms/${rId}/candidates/${side}`), e.candidate.toJSON());
    };

    return pc;
  };

  const joinRoomAsCaller = async (rId) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        await localVideoRef.current.play().catch(e => console.warn(e));
      }

      const pc = createPC(rId, true);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await set(ref(db, `rooms/${rId}/offer`), offer.toJSON());

      onValue(ref(db, `rooms/${rId}/answer`), async snap => {
        const ans = snap.val();
        if (ans) await pc.setRemoteDescription(ans);
      });

      // ICE candidates
      const candRef = ref(db, `rooms/${rId}/candidates/calleeCandidates`);
      onChildAdded(candRef, async snap => {
        try { await pc.addIceCandidate(snap.val()); } catch (e) { console.warn(e); }
      });
    } catch (e) { alert("Camera yoki mikrofonga ruxsat kerak!"); console.error(e); }
  };

  const joinRoomAsCallee = async (rId) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        await localVideoRef.current.play().catch(e => console.warn(e));
      }

      const pc = createPC(rId, false);

      onValue(ref(db, `rooms/${rId}/offer`), async snap => {
        const offer = snap.val();
        if (!offer) return;
        await pc.setRemoteDescription(offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await set(ref(db, `rooms/${rId}/answer`), answer.toJSON());
      });

      // ICE candidates
      const candRef = ref(db, `rooms/${rId}/candidates/callerCandidates`);
      onChildAdded(candRef, async snap => {
        try { await pc.addIceCandidate(snap.val()); } catch (e) { console.warn(e); }
      });
    } catch (e) { alert("Camera yoki mikrofonga ruxsat kerak!"); console.error(e); }
  };

  // --- Leave / Skip ---
  const leaveRoom = async () => {
    if (!user) return;
    const uid = user.uid;
    const myRoomRef = ref(db, `userRooms/${uid}`);
    const rsnap = await get(myRoomRef);
    const rId = rsnap.val();
    if (rId) {
      await remove(myRoomRef);
      const roomSnap = await get(ref(db, `rooms/${rId}`));
      if (roomSnap.exists()) await remove(ref(db, `rooms/${rId}`));
    }
    if (pcRef.current) pcRef.current.close(), pcRef.current = null;
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop()), localStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setRoomId(null); setRole(null); setPartnerName("");
  };

  const skipPartner = async () => {
    await leaveRoom();
    enterQueue();
  };

  // --- Logout / Mic / Cam ---
  const logout = async () => { await leaveQueue(); await leaveRoom(); await signOut(auth); setUser(null); };
  const toggleMic = () => { if (localStreamRef.current) localStreamRef.current.getAudioTracks().forEach(t => t.enabled = !t.enabled); setMicOn(s => !s); };
  const toggleCam = () => { if (localStreamRef.current) localStreamRef.current.getVideoTracks().forEach(t => t.enabled = !t.enabled); setCamOn(s => !s); };

  // --- UI ---
  return (
    <div className="min-h-screen bg-gray-100 p-4 flex flex-col items-center">
      {!user && (
        <div className="bg-white p-6 rounded shadow w-full max-w-md flex flex-col gap-3">
          <h2 className="text-2xl font-bold text-center mb-3">Login / Register</h2>
          <input placeholder="Ism" className="p-2 border rounded" value={name} onChange={e => setName(e.target.value)} />
          <input placeholder="Email" className="p-2 border rounded" value={email} onChange={e => setEmail(e.target.value)} />
          <input placeholder="Password" type="password" className="p-2 border rounded" value={password} onChange={e => setPassword(e.target.value)} />
          <div className="flex gap-2 mt-2">
            <button onClick={login} className="flex-1 p-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition">Login</button>
            <button onClick={register} className="flex-1 p-2 bg-green-500 text-white rounded hover:bg-green-600 transition">Register</button>
          </div>
        </div>
      )}

      {user && (
        <div className="flex flex-col lg:flex-row gap-4 w-full max-w-6xl mt-4">
          <div className="flex-1 bg-black rounded-lg relative aspect-video shadow-lg">
            <video ref={localVideoRef} autoPlay playsInline muted className="absolute w-full h-full object-cover rounded-lg" />
            <video ref={remoteVideoRef} autoPlay playsInline className="absolute w-full h-full object-cover rounded-lg" />
            <div className="absolute bottom-3 left-3 flex gap-2 flex-wrap">
              <button onClick={toggleMic} className={`px-3 py-1 rounded ${micOn ? "bg-green-500" : "bg-red-500"} text-white`}>{micOn ? "Mic ON" : "Mic OFF"}</button>
              <button onClick={toggleCam} className={`px-3 py-1 rounded ${camOn ? "bg-green-500" : "bg-red-500"} text-white`}>{camOn ? "Cam ON" : "Cam OFF"}</button>
              {!roomId && <button onClick={enterQueue} className="px-3 py-1 rounded bg-blue-500 text-white">{inQueue ? "Waiting..." : "Start Random Call"}</button>}
              {roomId && <button onClick={leaveRoom} className="px-3 py-1 rounded bg-red-600 text-white">Hang Up</button>}
              {roomId && <button onClick={skipPartner} className="px-3 py-1 rounded bg-yellow-500 text-white">Skip</button>}
              <button onClick={logout} className="px-3 py-1 rounded bg-gray-700 text-white">Logout</button>
            </div>
            {roomId && <div className="absolute top-2 left-2 px-2 py-1 bg-black bg-opacity-50 text-white rounded">Partner: {partnerName}</div>}
          </div>

          <div className="w-full lg:w-80 bg-white p-4 rounded shadow">
            <h3 className="font-semibold mb-2">Online Users</h3>
            {Object.values(onlineUsers).map((u, i) => <div key={i} className="py-1 border-b">{u.name}</div>)}
          </div>
        </div>
      )}
    </div>
  );
}
