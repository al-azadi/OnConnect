from django.conf import settings
from django.db import models
from django.db.models import F, Q


class Connection(models.Model):
    """A request to connect between two members. Once accepted it is a two-way link."""

    PENDING = "pending"
    ACCEPTED = "accepted"
    STATUS_CHOICES = [(PENDING, "Pending"), (ACCEPTED, "Accepted")]

    requester = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="connections_sent",
    )
    addressee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="connections_received",
    )
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    responded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["requester", "addressee"],
                name="unique_connection_direction",
            ),
            models.CheckConstraint(
                condition=~Q(requester=F("addressee")),
                name="no_self_connection",
            ),
        ]

    def __str__(self):
        return f"{self.requester} -> {self.addressee} ({self.status})"


class Message(models.Model):
    """A private chat message. Only connected members may send to each other."""

    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="messages_sent",
    )
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="messages_received",
    )
    body = models.CharField(max_length=2000)
    created_at = models.DateTimeField(auto_now_add=True)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["id"]
        indexes = [
            models.Index(fields=["recipient", "read_at"], name="msg_recipient_read_idx"),
            models.Index(fields=["sender", "recipient", "id"], name="msg_pair_idx"),
        ]

    def __str__(self):
        return f"{self.sender} -> {self.recipient}: {self.body[:30]}"
