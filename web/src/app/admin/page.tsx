"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface User {
  id: number;
  email: string;
  is_admin: number;
  is_active: number;
  created_at: string;
}

export default function AdminPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<number | null>(null);

  async function fetchUsers() {
    const res = await fetch("/api/admin/users");
    if (res.status === 403) {
      setError("Access denied — admin only");
      setLoading(false);
      return;
    }
    if (!res.ok) {
      setError("Failed to load users");
      setLoading(false);
      return;
    }
    const data = await res.json();
    setUsers(data.users);
    setLoading(false);
  }

  useEffect(() => {
    fetchUsers();
  }, []);

  async function toggleActive(targetUserId: number, active: boolean) {
    setToggling(targetUserId);
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId, is_active: active }),
    });
    setUsers((prev) =>
      prev.map((u) =>
        u.id === targetUserId ? { ...u, is_active: active ? 1 : 0 } : u
      )
    );
    setToggling(null);
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto py-8">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto py-8">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Admin — Users</h1>
      <Card>
        <CardHeader>
          <CardTitle>Users ({users.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="pb-2 font-medium">Email</th>
                <th className="pb-2 font-medium">Created</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b last:border-0">
                  <td className="py-2">{user.email}</td>
                  <td className="py-2">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="py-2">
                    {user.is_active ? (
                      <Badge className="bg-green-600 text-white">Active</Badge>
                    ) : (
                      <Badge variant="destructive">Inactive</Badge>
                    )}
                  </td>
                  <td className="py-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={toggling === user.id}
                      onClick={() =>
                        toggleActive(user.id, !user.is_active)
                      }
                    >
                      {user.is_active ? "Deactivate" : "Activate"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
