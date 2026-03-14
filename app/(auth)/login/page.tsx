"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { 
  AuthLayout, 
  AuthCard, 
  AuthInput, 
  AuthButton, 
  SocialButton, 
  VellumLogo 
} from "@/components/auth/AuthComponents";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSendCode = async () => {
    if (!email) return;
    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (response.ok) {
        // Redirect to verify page with email in query param
        router.push(`/verify?email=${encodeURIComponent(email)}`);
      } else {
        const data = await response.json();
        alert(data.error || "Failed to send OTP.");
      }
    } catch (error) {
      console.error("Error sending OTP:", error);
      alert("An unexpected error occurred.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout>
      <AuthCard>
        <VellumLogo />
        
        <h1 className="text-2xl font-bold text-[#111827] mb-2 text-center">Welcome back</h1>
        <p className="text-[#6b7280] text-sm mb-8 text-center">
          Enter your email to sign in to your workspace.
        </p>

        <div className="w-full space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[#374151] ml-0.5">
              Email address
            </label>
            <AuthInput
              type="email"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              }
            />
          </div>

          <AuthButton onClick={handleSendCode} disabled={isLoading || !email}>
            {isLoading ? "Sending..." : "Send Verification Code"}
          </AuthButton>

          <div className="relative flex items-center py-4">
            <div className="grow border-t border-[#e5e7eb]"></div>
            <span className="shrink mx-4 text-xs text-[#9ca3af] uppercase tracking-wider">or continue with</span>
            <div className="grow border-t border-[#e5e7eb]"></div>
          </div>

          <div className="space-y-3">
            <SocialButton
              provider="google"
              onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
              label="Google"
              icon={
                <svg viewBox="0 0 24 24" className="w-5 h-5">
                  <path fill="#EA4335" d="M5.266 9.765A7.077 7.077 0 0 1 12 4.909c1.69 0 3.23.6 4.38 1.55l3.51-3.51C17.65 1.05 14.99 0 12 0 7.33 0 3.32 2.69 1.34 6.64l3.926 3.125z" />
                  <path fill="#FBBC05" d="M1.34 6.64c-.51 1.01-.81 2.14-.81 3.36s.3 2.35.81 3.36l3.926-3.125A7.087 7.087 0 0 1 4.545 10c0-.85.15-1.66.417-2.428L1.34 6.64z" />
                  <path fill="#4285F4" d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.8-3.13a4.706 4.706 0 0 1-2.92.83 4.755 4.755 0 0 1-4.49-3.32l-3.926 3.125A11.967 11.967 0 0 0 12 24z" />
                  <path fill="#34A853" d="M23.49 12.275c0-.8-.07-1.57-.2-2.32H12v4.39h6.44a5.502 5.502 0 0 1-2.39 3.61l3.8 3.13C22.09 19.09 23.49 15.99 23.49 12.275z" />
                </svg>
              }
            />
            <SocialButton
              provider="microsoft"
              onClick={() => signIn("azure-ad", { callbackUrl: "/dashboard" })}
              label="Microsoft"
              icon={
                <svg viewBox="0 0 23 23" className="w-5 h-5">
                  <path fill="#f35325" d="M0 0h11v11H0z" />
                  <path fill="#81bc06" d="M12 0h11v11H12z" />
                  <path fill="#05a6f0" d="M0 12h11v11H0z" />
                  <path fill="#ffba08" d="M12 12h11v11H12z" />
                </svg>
              }
            />
          </div>

          <p className="text-center text-[11px] text-[#9ca3af] mt-8 leading-relaxed">
            By clicking continue, you agree to our{" "}
            <a href="#" className="text-[#6366f1] hover:underline">Terms of Service</a>
            <br />
            and <a href="#" className="text-[#6366f1] hover:underline">Privacy Policy</a>.
          </p>
        </div>
      </AuthCard>
    </AuthLayout>
  );
}