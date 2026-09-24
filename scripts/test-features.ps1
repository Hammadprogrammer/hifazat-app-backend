$ErrorActionPreference = 'Stop'
$B = 'http://localhost:4000/api'
$phone = '+9230' + (Get-Random -Minimum 10000000 -Maximum 99999999)

function J($o) { $o | ConvertTo-Json -Depth 6 -Compress }
function Call($m, $p, $body, $tok) {
  $h = @{}
  if ($tok) { $h['Authorization'] = "Bearer $tok" }
  $args = @{ Method = $m; Uri = "$B$p"; Headers = $h; ContentType = 'application/json' }
  if ($body) { $args['Body'] = (J $body) }
  try { Invoke-RestMethod @args } catch { $_.ErrorDetails.Message }
}

Write-Host "== signup"; $s = Call POST '/auth/signup' @{ name='Test User'; phone=$phone; city='Lahore'; password='pass1234' }
Write-Host "== login";  $l = Call POST '/auth/login'  @{ phone=$phone; password='pass1234' }
Write-Host "== otp";    $v = Call POST '/auth/verify-otp' @{ phone=$phone; otp='123456' }
$tok = $v.data.token
if (-not $tok) { Write-Host (J $v); throw 'no token' }

Write-Host "== contact"; J (Call POST '/contacts' @{ name='Ammi'; phone='+923001234567'; relation='Mother'; priority=1 } $tok)
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
Write-Host "== alert trigger"; $a = Call POST '/alerts/trigger' @{ latitude=31.52; longitude=74.35; address='Lahore'; source='sos' } $tok; J @{ id=$a.data.alert.id; status=$a.data.alert.status }
$aid = $a.data.alert.id
Write-Host "== alert active"; J (Call GET '/alerts/active' $null $tok)
Write-Host "== alert location"; J (Call POST "/alerts/$aid/location" @{ latitude=31.53; longitude=74.36; accuracy=10 } $tok)
Write-Host "== alert locations"; J (Call GET "/alerts/$aid/locations" $null $tok)
Write-Host "== alert safe"; J (Call POST "/alerts/$aid/safe" $null $tok)
Write-Host "== alert cancel (should 409)"; J (Call POST "/alerts/$aid/cancel" $null $tok)
Write-Host "== history"; J (Call GET '/alerts/history' $null $tok)
