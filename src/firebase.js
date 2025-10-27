import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyAqy_0l7dMarqgi-sFcujokfGFFzkeyg-c",
  authDomain: "jonlichat-9d081.firebaseapp.com",
  projectId: "jonlichat-9d081",
  storageBucket: "jonlichat-9d081.appspot.com",
  messagingSenderId: "645539341437",
  appId: "1:645539341437:web:46483b31aaa721caba3d14",
  measurementId: "G-K7P7X4YF5G"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export default app;
