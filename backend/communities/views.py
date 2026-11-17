from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404

from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Community, Membership
from .serializers import CommunitySerializer
from .permissions import can_manage


class CommunityListCreateView(generics.ListCreateAPIView):
    serializer_class = CommunitySerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        user = self.request.user

        queryset = Community.objects.select_related("owner")

        if user.is_authenticated:
            queryset = queryset.filter(
                Q(visibility=Community.PUBLIC)
                | Q(
                    memberships__user=user,
                    memberships__status=Membership.ACTIVE,
                )
            ).distinct()
        else:
            queryset = queryset.filter(
                visibility=Community.PUBLIC
            )

        search = self.request.query_params.get("search", "").strip()

        if search:
            queryset = queryset.filter(
                Q(name__icontains=search)
                | Q(description__icontains=search)
            )

        return queryset

    @transaction.atomic
    def perform_create(self, serializer):
        community = serializer.save(owner=self.request.user)

        Membership.objects.create(
            community=community,
            user=self.request.user,
            role=Membership.OWNER,
            status=Membership.ACTIVE,
        )


class CommunityDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = CommunitySerializer
    lookup_field = "slug"

    def get_queryset(self):
        user = self.request.user

        queryset = Community.objects.select_related("owner")

        if user.is_authenticated:
            return queryset.filter(
                Q(visibility=Community.PUBLIC)
                | Q(
                    memberships__user=user,
                    memberships__status=Membership.ACTIVE,
                )
            ).distinct()

        return queryset.filter(visibility=Community.PUBLIC)

    def get_permissions(self):
        if self.request.method in ["PUT", "PATCH", "DELETE"]:
            return [permissions.IsAuthenticated()]

        return [permissions.AllowAny()]

    def check_object_permissions(self, request, obj):
        super().check_object_permissions(request, obj)

        if request.method in ["PUT", "PATCH", "DELETE"]:
            if not can_manage(request.user, obj):
                self.permission_denied(
                    request,
                    message="Only owners and administrators can manage this community.",
                )


class CommunityJoinView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, slug):
        community = get_object_or_404(
            Community,
            slug=slug,
        )

        existing = Membership.objects.filter(
            community=community,
            user=request.user,
        ).first()

        if existing and existing.status == Membership.ACTIVE:
            return Response({
                "detail": "You are already a member.",
                "status": "active",
            })

        if (
            community.member_limit
            and community.active_member_count >= community.member_limit
        ):
            return Response(
                {"detail": "Community membership limit reached."},
                status=status.HTTP_409_CONFLICT,
            )

        new_status = (
            Membership.PENDING
            if community.visibility == Community.PRIVATE
            else Membership.ACTIVE
        )

        if existing:
            existing.status = new_status
            existing.role = Membership.MEMBER
            existing.save(update_fields=["status", "role"])
        else:
            Membership.objects.create(
                community=community,
                user=request.user,
                status=new_status,
            )

        return Response({
            "detail": (
                "Membership request submitted."
                if new_status == Membership.PENDING
                else "You joined the community."
            ),
            "status": new_status,
        }, status=status.HTTP_201_CREATED)


class CommunityLeaveView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, slug):
        community = get_object_or_404(
            Community,
            slug=slug,
        )

        membership = get_object_or_404(
            Membership,
            community=community,
            user=request.user,
        )

        if membership.role == Membership.OWNER:
            return Response(
                {"detail": "The owner cannot leave the community."},
                status=400,
            )

        membership.delete()

        return Response({"detail": "You left the community."})


class MembershipRequestListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, slug):
        community = get_object_or_404(
            Community,
            slug=slug,
        )

        if not can_manage(request.user, community):
            return Response(
                {"detail": "Only owners and administrators can review requests."},
                status=403,
            )

        pending = Membership.objects.filter(
            community=community,
            status=Membership.PENDING,
        ).select_related("user")

        return Response([
            {
                "id": item.id,
                "user_id": item.user_id,
                "username": item.user.username,
                "display_name": item.user.display_name,
                "joined_at": item.joined_at,
            }
            for item in pending
        ])


class MembershipDecisionView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, slug, membership_id):
        community = get_object_or_404(
            Community,
            slug=slug,
        )

        if not can_manage(request.user, community):
            return Response({"detail": "Permission denied."}, status=403)

        membership = get_object_or_404(
            Membership,
            id=membership_id,
            community=community,
            status=Membership.PENDING,
        )

        decision = request.data.get("decision")

        if decision == "approve":
            if (
                community.member_limit
                and community.active_member_count >= community.member_limit
            ):
                return Response(
                    {"detail": "Community membership limit reached."},
                    status=409,
                )

            membership.status = Membership.ACTIVE
            membership.save(update_fields=["status"])

            return Response({"detail": "Membership approved."})

        if decision == "reject":
            membership.delete()
            return Response({"detail": "Membership request rejected."})

        return Response(
            {"detail": "Decision must be approve or reject."},
            status=400,
        )


class MembershipRoleView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request, slug, membership_id):
        community = get_object_or_404(
            Community,
            slug=slug,
        )

        if not can_manage(request.user, community):
            return Response({"detail": "Permission denied."}, status=403)

        membership = get_object_or_404(
            Membership,
            id=membership_id,
            community=community,
            status=Membership.ACTIVE,
        )

        role = request.data.get("role")

        allowed_roles = [
            Membership.ADMIN,
            Membership.MODERATOR,
            Membership.MEMBER,
        ]

        if role not in allowed_roles:
            return Response(
                {"detail": "Allowed roles: admin, moderator, member."},
                status=400,
            )

        if membership.role == Membership.OWNER:
            return Response(
                {"detail": "Owner role cannot be changed here."},
                status=400,
            )

        if request.user.id == membership.user_id:
            return Response(
                {"detail": "You cannot change your own role."},
                status=400,
            )

        membership.role = role
        membership.save(update_fields=["role"])

        return Response({"detail": "Membership role updated."})
