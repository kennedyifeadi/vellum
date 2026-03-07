"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  const handleEmailOtpSignIn = async () => {
    if (!otpSent) {
      // Request OTP
      const response = await fetch("/api/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (response.ok) {
        setOtpSent(true);
        alert("OTP sent to your email!");
      } else {
        alert("Failed to send OTP.");
      }
    } else {
      // Verify OTP and sign in
      const result = await signIn("email-otp", {
        email,
        otp,
        redirect: false,
      });

      if (result?.error) {
        alert(result.error);
      } else {
        // Check if user needs to complete profile
        const res = await fetch("/api/auth/session"); // Get updated session
        const session = await res.json();
        if (!session.user.isProfileComplete) {
          window.location.href = "/signup-details";
        } else {
          window.location.href = "/dashboard";
        }
      }
    }
  };

  return (
    <div>
      <h1>Login / Sign Up</h1>
      <input
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      {otpSent && (
        <input
          type="text"
          placeholder="OTP"
          value={otp}
          onChange={(e) => setOtp(e.target.value)}
        />
      )}
      <button onClick={handleEmailOtpSignIn}>
        {otpSent ? "Verify OTP & Sign In" : "Send OTP"}
      </button>

      <p>OR</p>

      <button onClick={() => signIn("google")}>Sign in with Google</button>
      <button onClick={() => signIn("azure-ad")}>Sign in with Microsoft</button>
    </div>
  );
}