import React, { useState, useEffect, useRef } from "react";
import { auth, db } from "./firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "firebase/auth";
import { ref, set, onValue, push, remove, onDisconnect } from "firebase/database";

export default function App() {
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [onlineUsers, setOnlineUsers] = useState({});
  const [inQueue, setInQueue] = useState(false);
  const [roomId, setRoomId] = useState(null);
  const [partnerName, setPartnerName] = useState("");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  const iframeRef = useRef(null);

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

  // --- Queue logic ---
  const enterQueue = async () => {
    if (!user) return alert("Login qilishingiz kerak!");
    const uid = user.uid;
    const myQueueRef = ref(db, `queue/${uid}`);
    await set(myQueueRef, { name: name || user.displayName || "Anon" });
    onDisconnect(myQueueRef).remove();
    setInQueue(true);

    const queueRef = ref(db, "queue");
    onValue(queueRef, async (snap) => {
      const queueObj = snap.val() || {};
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

  // --- Room join logic ---
  useEffect(() => {
    if (!user) return;
    const urRef = ref(db, `userRooms/${user.uid}`);
    onValue(urRef, (snap) => {
      const rId = snap.val();
      if (!rId) { setRoomId(null); setPartnerName(""); return; }
      setRoomId(rId);
      const roomRef = ref(db, `rooms/${rId}`);
      onValue(roomRef, (roomSnap) => {
        const room = roomSnap.val(); if (!room) return;
        const otherUid = room.caller === user.uid ? room.callee : room.caller;
        setPartnerName(onlineUsers[otherUid]?.name || "Unknown");
        // Auto join Jitsi
        if (iframeRef.current) {
          const roomName = `jonchat_${rId}`;
          iframeRef.current.src = `https://meet.jit.si/${roomName}#userInfo.displayName="${name}"`;
        }
      });
    });
  }, [user, onlineUsers, name]);

  const leaveRoom = async () => {
    if (!user) return;
    const uid = user.uid;
    const rRef = ref(db, `userRooms/${uid}`);
    await remove(rRef);
    if (iframeRef.current) iframeRef.current.src = "";
    setRoomId(null);
    setPartnerName("");
  };

  const skipPartner = async () => { await leaveRoom(); enterQueue(); };
  const logout = async () => { await leaveQueue(); await leaveRoom(); await signOut(auth); setUser(null); };

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
            <iframe ref={iframeRef} allow="camera; microphone; fullscreen; display-capture" className="w-full h-full" />
            <div className="absolute bottom-4 left-4 flex gap-2 flex-wrap">
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
