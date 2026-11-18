from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from communities.models import Membership

from .models import Connection, Message

User = get_user_model()

MAX_MESSAGE_LENGTH = 2000
PEOPLE_LIMIT = 60


# --------------------------------------------------------------------------- #
#  Helpers
# --------------------------------------------------------------------------- #

def connection_map(user):
    """Return {other_user_id: Connection} for every connection that involves `user`."""
    rows = Connection.objects.filter(Q(requester=user) | Q(addressee=user))
    result = {}
    for conn in rows:
        other_id = conn.addressee_id if conn.requester_id == user.id else conn.requester_id
        result[other_id] = conn
    return result


def relation(viewer, other_id, cmap):
    """Describe how `viewer` is related to the member `other_id`."""
    if other_id == viewer.id:
        return "self", None
    conn = cmap.get(other_id)
    if conn is None:
        return "none", None
    if conn.status == Connection.ACCEPTED:
        return "connected", conn.id
    if conn.requester_id == viewer.id:
        return "pending_sent", conn.id
    return "pending_received", conn.id


def shared_community_counts(viewer, user_ids):
    """How many active communities each listed member shares with `viewer` (one query)."""
    if not user_ids:
        return {}
    mine = list(
        Membership.objects.filter(user=viewer, status=Membership.ACTIVE)
        .values_list("community_id", flat=True)
    )
    if not mine:
        return {}
    rows = (
        Membership.objects.filter(
            user_id__in=user_ids, community_id__in=mine, status=Membership.ACTIVE
        )
        .values("user_id")
        .annotate(total=Count("id"))
    )
    return {row["user_id"]: row["total"] for row in rows}


def person_dict(user, viewer, cmap, shared=0):
    state, connection_id = relation(viewer, user.id, cmap)
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name or user.username,
        "bio": user.bio,
        "avatar_url": user.avatar_url,
        "connection_status": state,
        "connection_id": connection_id,
        "shared_communities": shared,
        "date_joined": user.date_joined,
    }


def message_dict(message):
    return {
        "id": message.id,
        "sender": message.sender_id,
        "recipient": message.recipient_id,
        "body": message.body,
        "created_at": message.created_at,
        "read": message.read_at is not None,
    }


def are_connected(a, b):
    return Connection.objects.filter(status=Connection.ACCEPTED).filter(
        Q(requester=a, addressee=b) | Q(requester=b, addressee=a)
    ).exists()


# --------------------------------------------------------------------------- #
#  People
# --------------------------------------------------------------------------- #

class PeopleListView(APIView):
    """Members you may want to connect with, best matches (shared communities) first."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        search = request.query_params.get("search", "").strip()

        queryset = User.objects.filter(is_active=True).exclude(pk=user.pk)
        if search:
            queryset = queryset.filter(
                Q(username__icontains=search)
                | Q(display_name__icontains=search)
                | Q(bio__icontains=search)
            )

        people = list(queryset.order_by("-date_joined")[:PEOPLE_LIMIT])
        cmap = connection_map(user)
        shared = shared_community_counts(user, [p.id for p in people])

        data = [person_dict(p, user, cmap, shared.get(p.id, 0)) for p in people]
        data.sort(key=lambda item: (-item["shared_communities"], item["display_name"].lower()))
        return Response(data)


class PersonDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, username):
        user = request.user
        person = get_object_or_404(User, username__iexact=username, is_active=True)
        cmap = connection_map(user)
        shared = shared_community_counts(user, [person.id]).get(person.id, 0)

        data = person_dict(person, user, cmap, shared)
        data["connection_count"] = Connection.objects.filter(
            Q(requester=person) | Q(addressee=person), status=Connection.ACCEPTED
        ).count()
        return Response(data)


# --------------------------------------------------------------------------- #
#  Connections
# --------------------------------------------------------------------------- #

class ConnectionListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        rows = (
            Connection.objects.filter(Q(requester=user) | Q(addressee=user))
            .select_related("requester", "addressee")
        )
        cmap = {}
        for conn in rows:
            other_id = conn.addressee_id if conn.requester_id == user.id else conn.requester_id
            cmap[other_id] = conn

        connections, incoming, outgoing = [], [], []
        for conn in rows:
            other = conn.addressee if conn.requester_id == user.id else conn.requester
            person = person_dict(other, user, cmap)
            if conn.status == Connection.ACCEPTED:
                connections.append(person)
            elif conn.addressee_id == user.id:
                incoming.append({"id": conn.id, "person": person, "created_at": conn.created_at})
            else:
                outgoing.append({"id": conn.id, "person": person, "created_at": conn.created_at})

        return Response({"connections": connections, "incoming": incoming, "outgoing": outgoing})

    def post(self, request):
        user = request.user
        try:
            target_id = int(request.data.get("user_id"))
        except (TypeError, ValueError):
            return Response({"detail": "A valid user_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        if target_id == user.id:
            return Response({"detail": "You cannot connect with yourself."}, status=status.HTTP_400_BAD_REQUEST)

        target = get_object_or_404(User, pk=target_id, is_active=True)
        created = False

        with transaction.atomic():
            existing = (
                Connection.objects.select_for_update()
                .filter(Q(requester=user, addressee=target) | Q(requester=target, addressee=user))
                .first()
            )
            if existing is None:
                Connection.objects.create(requester=user, addressee=target)
                created = True
            elif existing.status == Connection.PENDING and existing.addressee_id == user.id:
                # They already asked you, so asking back simply accepts their request.
                existing.status = Connection.ACCEPTED
                existing.responded_at = timezone.now()
                existing.save(update_fields=["status", "responded_at"])

        cmap = connection_map(user)
        return Response(
            person_dict(target, user, cmap),
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class ConnectionDetailView(APIView):
    """Cancel a request you sent, decline one you received, or remove a connection."""

    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        conn = get_object_or_404(
            Connection.objects.filter(Q(requester=request.user) | Q(addressee=request.user)),
            pk=pk,
        )
        conn.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ConnectionRespondView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        conn = get_object_or_404(
            Connection, pk=pk, addressee=request.user, status=Connection.PENDING
        )
        action = request.data.get("action")

        if action == "accept":
            conn.status = Connection.ACCEPTED
            conn.responded_at = timezone.now()
            conn.save(update_fields=["status", "responded_at"])
            cmap = connection_map(request.user)
            return Response(person_dict(conn.requester, request.user, cmap))

        if action == "decline":
            conn.delete()
            return Response({"detail": "Request declined."})

        return Response({"detail": "action must be 'accept' or 'decline'."}, status=status.HTTP_400_BAD_REQUEST)


# --------------------------------------------------------------------------- #
#  Chat
# --------------------------------------------------------------------------- #

class ConversationListView(APIView):
    """One row per person you have chatted with: last message plus unread count."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        unread = {
            row["sender_id"]: row["total"]
            for row in Message.objects.filter(recipient=user, read_at__isnull=True)
            .values("sender_id")
            .annotate(total=Count("id"))
        }
        cmap = connection_map(user)

        conversations = {}
        recent = (
            Message.objects.filter(Q(sender=user) | Q(recipient=user))
            .select_related("sender", "recipient")
            .order_by("-id")[:1000]
        )
        for message in recent:
            other = message.recipient if message.sender_id == user.id else message.sender
            if other.id in conversations:
                continue
            conversations[other.id] = {
                "person": person_dict(other, user, cmap),
                "last_message": message_dict(message),
                "unread": unread.get(other.id, 0),
            }

        return Response(list(conversations.values()))


class ChatView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "chat"

    def _partner(self, request, username):
        partner = get_object_or_404(User, username__iexact=username, is_active=True)
        return partner

    def get(self, request, username):
        user = request.user
        partner = self._partner(request, username)
        if partner.pk == user.pk:
            return Response({"detail": "You cannot chat with yourself."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            after = max(int(request.query_params.get("after", 0)), 0)
        except ValueError:
            after = 0

        pair = Message.objects.filter(
            Q(sender=user, recipient=partner) | Q(sender=partner, recipient=user)
        )
        if after:
            messages = list(pair.filter(id__gt=after).order_by("id")[:200])
        else:
            messages = list(pair.order_by("-id")[:100])[::-1]

        Message.objects.filter(sender=partner, recipient=user, read_at__isnull=True).update(
            read_at=timezone.now()
        )

        seen_up_to = (
            pair.filter(sender=user, read_at__isnull=False)
            .order_by("-id")
            .values_list("id", flat=True)
            .first()
        )

        cmap = connection_map(user)
        person = person_dict(partner, user, cmap)
        return Response(
            {
                "person": person,
                "messages": [message_dict(m) for m in messages],
                "can_message": person["connection_status"] == "connected",
                "seen_up_to": seen_up_to or 0,
            }
        )

    def post(self, request, username):
        user = request.user
        partner = self._partner(request, username)
        if partner.pk == user.pk:
            return Response({"detail": "You cannot message yourself."}, status=status.HTTP_400_BAD_REQUEST)

        body = str(request.data.get("body", "")).strip()
        if not body:
            return Response({"detail": "Write a message first."}, status=status.HTTP_400_BAD_REQUEST)
        if len(body) > MAX_MESSAGE_LENGTH:
            return Response(
                {"detail": f"Messages can be at most {MAX_MESSAGE_LENGTH} characters."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not are_connected(user, partner):
            return Response(
                {"detail": "You can only message people you are connected with."},
                status=status.HTTP_403_FORBIDDEN,
            )

        message = Message.objects.create(sender=user, recipient=partner, body=body)
        return Response(message_dict(message), status=status.HTTP_201_CREATED)


class SummaryView(APIView):
    """Small, cheap endpoint the browser polls for badges and new-message alerts."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        unread = Message.objects.filter(recipient=user, read_at__isnull=True)
        latest = unread.select_related("sender").order_by("-id").first()

        return Response(
            {
                "unread_messages": unread.count(),
                "pending_requests": Connection.objects.filter(
                    addressee=user, status=Connection.PENDING
                ).count(),
                "latest": None
                if latest is None
                else {
                    "id": latest.id,
                    "username": latest.sender.username,
                    "display_name": latest.sender.display_name or latest.sender.username,
                    "preview": latest.body[:80],
                },
            }
        )
