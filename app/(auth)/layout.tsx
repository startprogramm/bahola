import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import { getCrossAppAccessViolation } from "@/lib/app-access";
import { isMaktab } from "@/lib/platform";

const testimonials = [
  { quote: "Har hafta 10+ soat vaqtimni tejaydi", author: "O'qituvchi, Toshkent" },
  { quote: "O'quvchilarim tezkor natija oladi", author: "O'qituvchi, Samarqand" },
  { quote: "Eng yaxshi baholash vositasi", author: "O'qituvchi, Buxoro" },
];

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getAuthSession();

  if (session) {
    const accessViolation = getCrossAppAccessViolation(session.user);
    if (accessViolation) {
      redirect(accessViolation.loginUrl);
    }

    if ((session.user as { role?: string })?.role === "DIRECTOR") {
      redirect("/director");
    }
    redirect("/classes");
  }

  if (isMaktab()) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
        <div className="w-full max-w-md px-4 animate-fade-in-up">{children}</div>
        <p className="mt-6 text-xs text-gray-400">maktab.bahola.uz</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden bg-gray-50">
      {/* Background decorative blobs - using fixed light colors */}
      <div
        className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full opacity-[0.15] animate-float-slow pointer-events-none"
        style={{ background: "radial-gradient(circle, #3b82f6 0%, transparent 70%)", filter: "blur(100px)" }}
      />
      <div
        className="absolute -bottom-[20%] -right-[10%] w-[45%] h-[45%] rounded-full opacity-[0.1] animate-float-slow animation-delay-3000 pointer-events-none"
        style={{ background: "radial-gradient(circle, #8b5cf6 0%, transparent 70%)", filter: "blur(100px)" }}
      />
      <div
        className="absolute top-[30%] right-[20%] w-[25%] h-[25%] rounded-full opacity-[0.08] animate-pulse-slow pointer-events-none"
        style={{ background: "radial-gradient(circle, #06b6d4 0%, transparent 70%)", filter: "blur(80px)" }}
      />

      {/* Trust line above the card */}
      <div className="relative z-10 mb-6 text-center animate-fade-in-down">
        <p className="text-sm text-gray-400 tracking-wide">
          Trusted by <span className="text-gray-600 font-medium">500+</span> teachers in Uzbekistan
        </p>
      </div>

      <div className="w-full max-w-md px-4 relative z-10 animate-fade-in-up">{children}</div>

      {/* Rotating testimonials */}
      <div className="relative z-10 mt-8 text-center animate-fade-in h-12 overflow-hidden">
        <div className="testimonial-rotate">
          {testimonials.map((t, i) => (
            <div key={i} className="h-12 flex flex-col items-center justify-center">
              <p className="text-xs text-gray-500 italic">&ldquo;{t.quote}&rdquo;</p>
              <p className="text-[10px] text-gray-400 mt-0.5">&mdash; {t.author}</p>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .testimonial-rotate {
          animation: testimonial-scroll 9s ease-in-out infinite;
        }
        @keyframes testimonial-scroll {
          0%, 30% { transform: translateY(0); }
          33%, 63% { transform: translateY(-48px); }
          66%, 96% { transform: translateY(-96px); }
          100% { transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
