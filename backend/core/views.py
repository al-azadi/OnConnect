from django.db import connection
from django.db.utils import OperationalError
from django.http import JsonResponse

def health(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        database = "connected"
    except OperationalError:
        database = "unavailable"
    return JsonResponse({
        "status": "ok",
        "application": "OnConnect",
        "database": database,
    })
