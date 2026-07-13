import Journal from "@/components/journal";
import Login from "@/components/login";
import { isAuthenticated, passwordConfigured } from "@/lib/auth";

export default async function Home() { return await isAuthenticated() ? <Journal /> : <Login configured={passwordConfigured()} />; }
