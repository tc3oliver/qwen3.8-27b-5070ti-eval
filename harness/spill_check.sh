#!/usr/bin/env bash
# Prints GPU used/free (WSL view) and the WSL VM's dedicated/shared GPU memory from Windows perf counters.
# Shared usage well above the idle baseline (~170 MiB here) means model memory spilled to system RAM.
nvidia-smi --query-gpu=memory.used,memory.free --format=csv,noheader | sed 's/^/gpu used,free: /'
cd /mnt/c && powershell.exe -NoProfile -Command '$p=(Get-Process vmwp).Id; foreach($c in "Dedicated","Shared"){ $v=((Get-Counter "\GPU Process Memory(*)\$c Usage").CounterSamples | ?{$_.InstanceName -match "pid_($($p -join "|"))_"} | Measure-Object CookedValue -Sum).Sum/1MB; "wsl vm {0}: {1:N0} MiB" -f $c.ToLower(),$v }' | tr -d '\r'
