from django.urls import path

from .views import (
    ChatView,
    ConnectionDetailView,
    ConnectionListCreateView,
    ConnectionRespondView,
    ConversationListView,
    PeopleListView,
    PersonDetailView,
    SummaryView,
)

urlpatterns = [
    path("people/", PeopleListView.as_view(), name="people"),
    path("people/<str:username>/", PersonDetailView.as_view(), name="person-detail"),
    path("connections/", ConnectionListCreateView.as_view(), name="connections"),
    path("connections/<int:pk>/", ConnectionDetailView.as_view(), name="connection-detail"),
    path("connections/<int:pk>/respond/", ConnectionRespondView.as_view(), name="connection-respond"),
    path("messages/", ConversationListView.as_view(), name="conversations"),
    path("messages/with/<str:username>/", ChatView.as_view(), name="chat"),
    path("notifications/summary/", SummaryView.as_view(), name="notification-summary"),
]
