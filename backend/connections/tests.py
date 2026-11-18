from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from .models import Connection, Message

User = get_user_model()


class ConnectionAndChatTests(APITestCase):
    def setUp(self):
        self.alice = User.objects.create_user("alice", "a@example.com", "pass12345!")
        self.bob = User.objects.create_user("bob", "b@example.com", "pass12345!")
        self.carol = User.objects.create_user("carol", "c@example.com", "pass12345!")

    # -- helpers ------------------------------------------------------------
    def request_connection(self, requester, target):
        self.client.force_login(requester)
        return self.client.post("/api/connections/", {"user_id": target.id}, format="json")

    def make_friends(self, a, b):
        Connection.objects.create(requester=a, addressee=b, status=Connection.ACCEPTED)

    # -- connections --------------------------------------------------------
    def test_request_then_accept(self):
        res = self.request_connection(self.alice, self.bob)
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["connection_status"], "pending_sent")

        self.client.force_login(self.bob)
        data = self.client.get("/api/connections/").data
        self.assertEqual(len(data["incoming"]), 1)

        res = self.client.post(
            f"/api/connections/{data['incoming'][0]['id']}/respond/", {"action": "accept"}, format="json"
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["connection_status"], "connected")

    def test_mutual_request_is_accepted_automatically(self):
        self.request_connection(self.alice, self.bob)
        res = self.request_connection(self.bob, self.alice)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["connection_status"], "connected")
        self.assertEqual(Connection.objects.count(), 1)

    def test_cannot_connect_with_yourself(self):
        res = self.request_connection(self.alice, self.alice)
        self.assertEqual(res.status_code, 400)

    def test_only_the_addressee_can_respond(self):
        self.request_connection(self.alice, self.bob)
        conn = Connection.objects.get()
        self.client.force_login(self.carol)
        res = self.client.post(f"/api/connections/{conn.id}/respond/", {"action": "accept"}, format="json")
        self.assertEqual(res.status_code, 404)

    def test_outsider_cannot_remove_a_connection(self):
        self.make_friends(self.alice, self.bob)
        conn = Connection.objects.get()
        self.client.force_login(self.carol)
        self.assertEqual(self.client.delete(f"/api/connections/{conn.id}/").status_code, 404)

    def test_people_list_hides_the_current_user(self):
        self.client.force_login(self.alice)
        names = [p["username"] for p in self.client.get("/api/people/").data]
        self.assertNotIn("alice", names)
        self.assertIn("bob", names)

    # -- chat ---------------------------------------------------------------
    def test_chat_requires_a_connection(self):
        self.client.force_login(self.alice)
        res = self.client.post("/api/messages/with/bob/", {"body": "hi"}, format="json")
        self.assertEqual(res.status_code, 403)

        self.make_friends(self.alice, self.bob)
        res = self.client.post("/api/messages/with/bob/", {"body": "hi"}, format="json")
        self.assertEqual(res.status_code, 201)

    def test_empty_and_overlong_messages_are_rejected(self):
        self.make_friends(self.alice, self.bob)
        self.client.force_login(self.alice)
        self.assertEqual(self.client.post("/api/messages/with/bob/", {"body": "   "}, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/messages/with/bob/", {"body": "x" * 2001}, format="json").status_code, 400)

    def test_unread_count_and_seen_marker(self):
        self.make_friends(self.alice, self.bob)
        self.client.force_login(self.alice)
        sent = self.client.post("/api/messages/with/bob/", {"body": "hello"}, format="json").data

        self.client.force_login(self.bob)
        self.assertEqual(self.client.get("/api/notifications/summary/").data["unread_messages"], 1)
        self.client.get("/api/messages/with/alice/")  # opening the chat marks it read
        self.assertEqual(self.client.get("/api/notifications/summary/").data["unread_messages"], 0)

        self.client.force_login(self.alice)
        self.assertEqual(self.client.get("/api/messages/with/bob/").data["seen_up_to"], sent["id"])

    def test_polling_returns_only_newer_messages(self):
        self.make_friends(self.alice, self.bob)
        first = Message.objects.create(sender=self.alice, recipient=self.bob, body="one")
        second = Message.objects.create(sender=self.alice, recipient=self.bob, body="two")
        self.client.force_login(self.bob)
        data = self.client.get(f"/api/messages/with/alice/?after={first.id}").data
        self.assertEqual([m["id"] for m in data["messages"]], [second.id])

    def test_conversation_list_shows_last_message_and_unread(self):
        self.make_friends(self.alice, self.bob)
        Message.objects.create(sender=self.alice, recipient=self.bob, body="first")
        Message.objects.create(sender=self.alice, recipient=self.bob, body="latest")
        self.client.force_login(self.bob)
        rows = self.client.get("/api/messages/").data
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["last_message"]["body"], "latest")
        self.assertEqual(rows[0]["unread"], 2)

    def test_anonymous_users_are_rejected(self):
        self.assertIn(self.client.get("/api/messages/").status_code, (401, 403))
