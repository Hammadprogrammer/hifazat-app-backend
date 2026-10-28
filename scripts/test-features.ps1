$ErrorActionPreference = 'Stop'
$B = 'http://localhost:4000/api'
$phone  = '+9230' + (Get-Random -Minimum 10000000 -Maximum 99999999)
$phoneB = '+9231' + (Get-Random -Minimum 10000000 -Maximum 99999999)
$phoneX = '+9232' + (Get-Random -Minimum 10000000 -Maximum 99999999)   # never registered

function J($o) { $o | ConvertTo-Json -Depth 6 -Compress }
function Call($m, $p, $body, $tok) {
  $h = @{}
  if ($tok) { $h['Authorization'] = "Bearer $tok" }
  $args = @{ Method = $m; Uri = "$B$p"; Headers = $h; ContentType = 'application/json' }
  if ($body) { $args['Body'] = (J $body) }
  try { Invoke-RestMethod @args } catch { $_.ErrorDetails.Message }
}

Write-Host "== signup A"; $s = Call POST '/auth/signup' @{ name='Test User'; phone=$phone; city='Lahore'; password='pass1234' }
Write-Host "== signup B"; $sb = Call POST '/auth/signup' @{ name='Guardian B'; phone=$phoneB; city='Karachi'; password='pass1234' }
Write-Host "== login A";  $l = Call POST '/auth/login'  @{ phone=$phone; password='pass1234' }
$tok = $l.data.token
if (-not $tok) { Write-Host (J $l); throw 'no token' }
Write-Host "== login B";  $lb = Call POST '/auth/login' @{ phone=$phoneB; password='pass1234' }
$tokB = $lb.data.token
if (-not $tokB) { Write-Host (J $lb); throw 'no token B' }

Write-Host "== device B register"; J (Call POST '/devices' @{ pushToken='ExponentPushToken[test-token-b]'; platform='android' } $tokB)
Write-Host "== contact self (should 400)"; J (Call POST '/contacts' @{ name='Me'; phone=$phone } $tok)
Write-Host "== contact B (isAppUser=true)"; J (Call POST '/contacts' @{ name='Guardian B'; phone=$phoneB; relation='Brother'; priority=1 } $tok)
Write-Host "== contact X (isAppUser=false + warning)"; J (Call POST '/contacts' @{ name='Ammi'; phone=$phoneX; relation='Mother'; priority=2 } $tok)
Write-Host "== contacts list"; J (Call GET '/contacts' $null $tok)
Write-Host "== settings get"; J (Call GET '/settings' $null $tok)
Write-Host "== settings put"; J (Call PUT '/settings' @{ shakeToAlert=$false; keepScreenOn=$true } $tok)
Write-Host "== alarms"; J (Call GET '/checkins/alarms' $null $tok)
Write-Host "== checkin safe"; J (Call POST '/checkins' @{ type='morning'; label='Morning' } $tok)
Write-Host "== checkins today"; J (Call GET '/checkins' $null $tok)
Write-Host "== score"; J (Call GET '/checkins/score' $null $tok)
Write-Host "== streak"; $st = Call GET '/streak' $null $tok; J @{ current=$st.data.currentStreak; best=$st.data.bestStreak; today=$st.data.todayCheckedIn; next=$st.data.nextMilestone }
Write-Host "== trip start"; $t = Call POST '/trips' @{ destination='Office'; estimatedMinutes=30 } $tok; J $t
Write-Host "== trip active"; J (Call GET '/trips/active' $null $tok)
Write-Host "== trip end"; J (Call POST "/trips/$($t.data.trip.id)/end" $null $tok)
Write-Host "== alert trigger (expect PARTIAL: 1 sent, 1 skipped)"; $a = Call POST '/alerts/trigger' @{ latitude=31.52; longitude=74.35; address='Lahore'; source='sos' } $tok; J @{ id=$a.data.alert.id; status=$a.data.alert.status; dispatches=$a.data.dispatches; skipped=$a.data.skipped }
$aid = $a.data.alert.id
Write-Host "== B notifications (expect SOS)"; $nb = Call GET '/notifications' $null $tokB; J $nb
Write-Host "== B unread count"; J (Call GET '/notifications/unread-count' $null $tokB)
$nid = $nb.data.notifications[0].id
Write-Host "== B mark read"; J (Call POST "/notifications/$nid/read" $null $tokB)
Write-Host "== alert active"; J (Call GET '/alerts/active' $null $tok)
Write-Host "== alert location"; J (Call POST "/alerts/$aid/location" @{ latitude=31.53; longitude=74.36; accuracy=10 } $tok)
Write-Host "== alert locations"; J (Call GET "/alerts/$aid/locations" $null $tok)
Write-Host "== alert location invalid (should 400)"; J (Call POST "/alerts/$aid/location" @{ latitude=0; longitude=0 } $tok)
Write-Host "== track as owner A"; $tr = Call GET "/alerts/$aid/track" $null $tok; J @{ isOwner=$tr.data.isOwner; active=$tr.data.active; latest=$tr.data.latest.latitude; trail=$tr.data.trail.Count }
Write-Host "== track as contact B (allowed)"; $trb = Call GET "/alerts/$aid/track" $null $tokB; J @{ isOwner=$trb.data.isOwner; sender=$trb.data.sender.name; latest=$trb.data.latest.latitude }
Write-Host "== alert safe"; J (Call POST "/alerts/$aid/safe" $null $tok)
Write-Host "== B notifications unread (expect SOS_SAFE)"; J (Call GET '/notifications?unread=1' $null $tokB)
Write-Host "== B read-all"; J (Call POST '/notifications/read-all' $null $tokB)
Write-Host "== alert cancel (should 409)"; J (Call POST "/alerts/$aid/cancel" $null $tok)
Write-Host "== history"; J (Call GET '/alerts/history' $null $tok)
Write-Host "== device B unregister"; J (Call DELETE '/devices/ExponentPushToken%5Btest-token-b%5D' $null $tokB)
