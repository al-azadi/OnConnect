from django.urls import path

from .views import (
    CommunityListCreateView,
    CommunityDetailView,
    CommunityJoinView,
    CommunityLeaveView,
    MembershipRequestListView,
    MembershipDecisionView,
    MembershipRoleView,
)

urlpatterns = [
    path("", CommunityListCreateView.as_view()),
    path("<slug:slug>/", CommunityDetailView.as_view()),

    path("<slug:slug>/join/", CommunityJoinView.as_view()),
    path("<slug:slug>/leave/", CommunityLeaveView.as_view()),

    path("<slug:slug>/requests/", MembershipRequestListView.as_view()),

    path(
        "<slug:slug>/requests/<int:membership_id>/",
        MembershipDecisionView.as_view(),
    ),

    path(
        "<slug:slug>/members/<int:membership_id>/role/",
        MembershipRoleView.as_view(),
    ),
]
