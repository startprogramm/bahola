"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Users,
  CreditCard,
  Search,
  RefreshCw,
  Shield,
  Coins,
  TrendingUp,
  CheckCircle,
  Clock,
  XCircle,
  CalendarDays,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface User {
  id: string;
  name: string;
  email: string | null;
  role: string;
  plan: string;
  credits: number;
  subscriptionExpiresAt: string | null;
  createdAt: string;
  _count?: { submissions: number; orders: number };
}

interface Order {
  id: string;
  numericId: number;
  plan: string;
  amount: number;
  status: string;
  completedAt: string | null;
  createdAt: string;
  user: { name: string; email: string | null };
}

const PLAN_BADGE_STYLES: Record<string, string> = {
  MAX: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  PRO: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  PLUS: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  FREE: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
};

const ORDER_STATUS_STYLES: Record<string, { icon: typeof CheckCircle; color: string; bg: string }> = {
  COMPLETED: { icon: CheckCircle, color: "text-green-600", bg: "bg-green-100 dark:bg-green-900/30" },
  PENDING: { icon: Clock, color: "text-yellow-600", bg: "bg-yellow-100 dark:bg-yellow-900/30" },
  PREPARING: { icon: Clock, color: "text-blue-600", bg: "bg-blue-100 dark:bg-blue-900/30" },
  CANCELLED: { icon: XCircle, color: "text-red-600", bg: "bg-red-100 dark:bg-red-900/30" },
};

function formatPrice(amount: number): string {
  return amount.toLocaleString("uz-UZ") + " so'm";
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(true);
  const [activeTab, setActiveTab] = useState<"users" | "orders">("users");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterTier, setFilterTier] = useState<string>("all");
  const [orderFilter, setOrderFilter] = useState<string>("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, ordersRes] = await Promise.all([
        fetch("/api/admin/users"),
        fetch("/api/admin/orders"),
      ]);

      if (usersRes.status === 401) {
        setIsAdmin(false);
        router.push("/classes");
        return;
      }

      if (usersRes.ok) setUsers(await usersRes.json());
      if (ordersRes.ok) setOrders(await ordersRes.json());
    } catch (error) {
      console.error("Failed to fetch admin data:", error);
    }
    setLoading(false);
  }, [router]);

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user) {
      router.push("/login");
      return;
    }
    fetchData();
  }, [session, status, router, fetchData]);

  const handleSetPlan = async (userId: string, plan: string) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/plan`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (res.ok) fetchData();
    } catch (error) {
      console.error("Failed to set plan:", error);
    }
  };

  const handleAddCredits = async (userId: string, amount: number) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/credits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      if (res.ok) fetchData();
    } catch (error) {
      console.error("Failed to add credits:", error);
    }
  };

  const filteredUsers = users.filter((user) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      (user.name || "").toLowerCase().includes(term) ||
      (user.email || "").toLowerCase().includes(term);
    const matchesPlan = filterTier === "all" || user.plan === filterTier;
    return matchesSearch && matchesPlan;
  });

  const filteredOrders = orders.filter((order) => {
    if (orderFilter === "all") return true;
    return order.status === orderFilter;
  });

  if (status === "loading" || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <RefreshCw className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) return null;

  const completedOrders = orders.filter((o) => o.status === "COMPLETED");
  const totalRevenue = completedOrders.reduce((sum, o) => sum + o.amount, 0);
  const stats = {
    totalUsers: users.length,
    paidUsers: users.filter((u) => u.plan !== "FREE").length,
    totalOrders: completedOrders.length,
    totalRevenue,
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Shield className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Admin Panel</h1>
            <p className="text-sm text-muted-foreground">Manage users and payments</p>
          </div>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Users", value: stats.totalUsers, icon: Users, color: "text-blue-500" },
          { label: "Paid Users", value: stats.paidUsers, icon: TrendingUp, color: "text-green-500" },
          { label: "Payments", value: stats.totalOrders, icon: CreditCard, color: "text-purple-500" },
          { label: "Revenue", value: formatPrice(stats.totalRevenue), icon: Coins, color: "text-amber-500" },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="p-4 rounded-xl bg-card border"
          >
            <div className="flex items-center gap-3">
              <stat.icon className={cn("w-5 h-5", stat.color)} />
              <div>
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {[
          { id: "users" as const, label: "Users", icon: Users },
          { id: "orders" as const, label: `Orders (${completedOrders.length})`, icon: CreditCard },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 border-b-2 transition-colors",
              activeTab === tab.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Users Tab */}
      {activeTab === "users" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by name or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-lg border bg-background"
              />
            </div>
            <select
              value={filterTier}
              onChange={(e) => setFilterTier(e.target.value)}
              className="px-4 py-2 rounded-lg border bg-background"
            >
              <option value="all">All Plans</option>
              <option value="FREE">Free</option>
              <option value="PLUS">Plus</option>
              <option value="PRO">Pro</option>
              <option value="MAX">Max</option>
            </select>
          </div>

          <p className="text-sm text-muted-foreground">{filteredUsers.length} users</p>

          {/* Users Table */}
          <div className="rounded-xl border overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium">User</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Plan</th>
                  <th className="px-4 py-3 text-left text-sm font-medium">Credits</th>
                  <th className="px-4 py-3 text-left text-sm font-medium hidden md:table-cell">Expires</th>
                  <th className="px-4 py-3 text-left text-sm font-medium hidden lg:table-cell">Submissions</th>
                  <th className="px-4 py-3 text-right text-sm font-medium">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredUsers.map((user) => {
                  const isUnlimited = user.plan === "PRO" || user.plan === "MAX";
                  const expiryDays = user.subscriptionExpiresAt ? daysUntil(user.subscriptionExpiresAt) : null;
                  const isExpiringSoon = expiryDays !== null && expiryDays <= 3 && expiryDays > 0;
                  const isExpired = expiryDays !== null && expiryDays <= 0;

                  return (
                    <tr key={user.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium">{user.name}</p>
                          <p className="text-sm text-muted-foreground">{user.email || "No email"}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={user.plan}
                          onChange={(e) => handleSetPlan(user.id, e.target.value)}
                          className={cn(
                            "px-2 py-1 rounded text-sm font-medium border-0 cursor-pointer",
                            PLAN_BADGE_STYLES[user.plan] || PLAN_BADGE_STYLES.FREE
                          )}
                        >
                          <option value="FREE">Free</option>
                          <option value="PLUS">Plus</option>
                          <option value="PRO">Pro</option>
                          <option value="MAX">Max</option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono">{isUnlimited ? "\u221E" : user.credits}</span>
                          <button
                            onClick={() => {
                              const amount = prompt("Add credits (enter number):");
                              if (amount && !isNaN(parseInt(amount))) {
                                handleAddCredits(user.id, parseInt(amount));
                              }
                            }}
                            className="p-1 rounded hover:bg-muted transition-colors"
                            title="Add credits"
                          >
                            <Coins className="w-4 h-4 text-muted-foreground" />
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        {user.plan === "FREE" ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : user.subscriptionExpiresAt ? (
                          <span className={cn(
                            "text-xs",
                            isExpired && "text-red-500 font-medium",
                            isExpiringSoon && "text-orange-500 font-medium",
                            !isExpired && !isExpiringSoon && "text-muted-foreground"
                          )}>
                            {isExpired
                              ? "Expired"
                              : isExpiringSoon
                                ? `${expiryDays}d left`
                                : formatDate(user.subscriptionExpiresAt)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">No expiry</span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="text-sm text-muted-foreground font-mono">
                          {user._count?.submissions ?? 0}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-xs text-muted-foreground">
                          {formatDate(user.createdAt)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredUsers.length === 0 && (
              <div className="p-8 text-center text-muted-foreground">
                No users found
              </div>
            )}
          </div>
        </div>
      )}

      {/* Orders Tab */}
      {activeTab === "orders" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <select
              value={orderFilter}
              onChange={(e) => setOrderFilter(e.target.value)}
              className="px-4 py-2 rounded-lg border bg-background"
            >
              <option value="all">All Statuses</option>
              <option value="COMPLETED">Completed</option>
              <option value="PENDING">Pending</option>
              <option value="PREPARING">Preparing</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            <span className="text-sm text-muted-foreground">{filteredOrders.length} orders</span>
          </div>

          {filteredOrders.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground rounded-xl border">
              <CreditCard className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No orders found</p>
            </div>
          ) : (
            <div className="rounded-xl border overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium">#</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">User</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Plan</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Amount</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Status</th>
                    <th className="px-4 py-3 text-right text-sm font-medium">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredOrders.map((order) => {
                    const statusInfo = ORDER_STATUS_STYLES[order.status] || ORDER_STATUS_STYLES.PENDING;
                    const StatusIcon = statusInfo.icon;
                    return (
                      <tr key={order.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <span className="text-sm font-mono text-muted-foreground">#{order.numericId}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-medium text-sm">{order.user.name}</p>
                            <p className="text-xs text-muted-foreground">{order.user.email || "No email"}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            "px-2 py-0.5 rounded text-xs font-medium",
                            PLAN_BADGE_STYLES[order.plan] || PLAN_BADGE_STYLES.FREE
                          )}>
                            {order.plan}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium">{formatPrice(order.amount)}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium",
                            statusInfo.bg, statusInfo.color
                          )}>
                            <StatusIcon className="w-3 h-3" />
                            {order.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-xs text-muted-foreground">
                            {formatDate(order.completedAt || order.createdAt)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
