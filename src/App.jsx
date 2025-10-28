import React, { useState, useEffect, useRef } from "react";
import { auth, db } from "./firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "firebase/auth";
import { ref, set, onValue, push, remove, onDisconnect, onChildAdded } from "firebase/database";

export default function App() {
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [onlineUsers, setOnlineUsers] = useState({});
  const [inQueue, setInQueue] = useState(false);
  const [roomId, setRoomId] = useState(null);
  const [role, setRole] = useState(null);
  const [partnerName, setPartnerName] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

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
    if (!name) return alert("Ismingizni kiriting!");
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      if (cred.user) await set(ref(db, `users/${cred.user.uid}`), { name });
    } catch (e) { alert(e.message); }
  };

  const login = async () => {
    try { await signInWithEmailAndPassword(auth, email, password); }
    catch (e) { alert(e.message); }
  };

  const enterQueue = async () => {
    if (!user) return alert("Login qilishingiz kerak!");
    const uid = user.uid;
    const myQueueRef = ref(db, `queue/${uid}`);
    await set(myQueueRef, { name: name || user.displayName || "Anon" });
    onDisconnect(myQueueRef).remove();
    setInQueue(true);

    const snap = await ref(db, "queue");
    onValue(snap, async (s) => {
      const queueObj = s.val() || {};
      const otherUid = Object.keys(queueObj).find(k => k !== uid);
      if (otherUid) {
        const newRoomRef = push(ref(db, "rooms"));
        const rId = newRoomRef.key;
        await set(newRoomRef, { caller: uid, callee: otherUid, createdAt: Date.now() });
        await set(ref(db, `userRooms/${uid}`), rId);
        await set(ref(db, `userRooms/${otherUid}`), rId);
        await remove(ref(db, `queue/${uid}`));
        await remove(ref(db, `queue/${otherUid}`));
        setInQueue(false);
      }
    });
  };

  const leaveQueue = async () => {
    if (!user) return;
    await remove(ref(db, `queue/${user.uid}`));
    setInQueue(false);
  };

  // --- WebRTC setup ---
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
      if (localVideoRef.current) { localVideoRef.current.srcObject = stream; await localVideoRef.current.play(); }
      const pc = createPC(rId, true);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await set(ref(db, `rooms/${rId}/offer`), offer.toJSON());

      // listen for answer
      onValue(ref(db, `rooms/${rId}/answer`), async snap => {
        const ans = snap.val();
        if (ans) await pc.setRemoteDescription(ans);
      });

      // listen for callee ICE
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
      if (localVideoRef.current) { localVideoRef.current.srcObject = stream; await localVideoRef.current.play(); }
      const pc = createPC(rId, false);

      onValue(ref(db, `rooms/${rId}/offer`), async snap => {
        const offer = snap.val(); if (!offer) return;
        await pc.setRemoteDescription(offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await set(ref(db, `rooms/${rId}/answer`), answer.toJSON());
      });

      const candRef = ref(db, `rooms/${rId}/candidates/callerCandidates`);
      onChildAdded(candRef, async snap => {
        try { await pc.addIceCandidate(snap.val()); } catch (e) { console.warn(e); }
      });

    } catch (e) { alert("Camera yoki mikrofonga ruxsat kerak!"); console.error(e); }
  };

  useEffect(() => {
    if (!user) return;
    const urRef = ref(db, `userRooms/${user.uid}`);
    onValue(urRef, async snap => {
      const rId = snap.val();
      if (!rId) { setRoomId(null); setRole(null); setPartnerName(""); return; }
      setRoomId(rId);
      const roomSnap = await ref(db, `rooms/${rId}`);
      onValue(roomSnap, async s => {
        const room = s.val(); if (!room) return;
        if (room.caller === user.uid) {
          setRole("caller");
          setPartnerName(onlineUsers[room.callee]?.name || "Unknown");
          joinRoomAsCaller(rId);
        } else if (room.callee === user.uid) {
          setRole("callee");
          setPartnerName(onlineUsers[room.caller]?.name || "Unknown");
          joinRoomAsCallee(rId);
        }
      });
    });
  }, [user, onlineUsers]);

  const leaveRoom = async () => {
    if (!user) return;
    const uid = user.uid;
    const rRef = ref(db, `userRooms/${uid}`);
    await remove(rRef);
    if (pcRef.current) pcRef.current.close();
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setRoomId(null); setRole(null); setPartnerName("");
  };

  const skipPartner = async () => { await leaveRoom(); enterQueue(); };
  const logout = async () => { await leaveQueue(); await leaveRoom(); await signOut(auth); setUser(null); };
  const toggleMic = () => { if (localStreamRef.current) localStreamRef.current.getAudioTracks().forEach(t => t.enabled = !t.enabled); setMicOn(s => !s); };
  const toggleCam = () => { if (localStreamRef.current) localStreamRef.current.getVideoTracks().forEach(t => t.enabled = !t.enabled); setCamOn(s => !s); };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center">
      {!user && (
        <div className="bg-white p-8 rounded-2xl shadow-lg w-full max-w-md flex flex-col gap-4">
          <h2 className="text-3xl font-bold text-center text-orange-500">VideoChat</h2>
          <input placeholder="Ism" value={name} onChange={e => setName(e.target.value)} className="p-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-400" />
          <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} className="p-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-400" />
          <input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} className="p-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-400" />
          <div className="flex gap-3 mt-4">
            <button onClick={login} className="flex-1 p-3 bg-orange-500 text-white rounded-xl hover:bg-orange-600 transition">Login</button>
            <button onClick={register} className="flex-1 p-3 bg-green-500 text-white rounded-xl hover:bg-green-600 transition">Register</button>
          </div>
        </div>
      )}

      {user && (
        <div className="flex flex-col lg:flex-row gap-6 w-full max-w-6xl mt-6">
          <div className="flex-1 bg-black rounded-2xl relative aspect-video shadow-lg overflow-hidden">
            <video ref={localVideoRef} autoPlay playsInline muted className="absolute w-full h-full object-cover" />
            <video ref={remoteVideoRef} autoPlay playsInline className="absolute w-full h-full object-cover" />
            <div className="absolute bottom-4 left-4 flex gap-2 flex-wrap">
              <button onClick={toggleMic} className={`px-4 py-2 rounded-full ${micOn ? "bg-green-500" : "bg-red-500"} text-white`}>{micOn ? "Mic ON" : "Mic OFF"}</button>
              <button onClick={toggleCam} className={`px-4 py-2 rounded-full ${camOn ? "bg-green-500" : "bg-red-500"} text-white`}>{camOn ? "Cam ON" : "Cam OFF"}</button>
              {!roomId && <button onClick={enterQueue} className="px-4 py-2 rounded-full bg-blue-500 text-white">{inQueue ? "Waiting..." : "Start Random Call"}</button>}
              {roomId && <button onClick={leaveRoom} className="px-4 py-2 rounded-full bg-red-600 text-white">Hang Up</button>}
              {roomId && <button onClick={skipPartner} className="px-4 py-2 rounded-full bg-yellow-500 text-white">Skip</button>}
              <button onClick={logout} className="px-4 py-2 rounded-full bg-gray-700 text-white">Logout</button>
            </div>
            {roomId && <div className="absolute top-4 left-4 px-3 py-1 bg-black bg-opacity-50 text-white rounded-full">Partner: {partnerName}</div>}
          </div>

          <div className="w-full lg:w-80 bg-white p-4 rounded-2xl shadow-lg">
            <h3 className="font-semibold text-lg mb-3">Online Users</h3>
            <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
              {Object.values(onlineUsers).map((u, i) => <div key={i} className="py-2 px-3 bg-gray-100 rounded-xl">{u.name}</div>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
