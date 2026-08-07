{{/*
Expand the name of the chart.
*/}}
{{- define "saas-web-application.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "saas-web-application.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "saas-web-application.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "saas-web-application.labels" -}}
helm.sh/chart: {{ include "saas-web-application.chart" . }}
{{ include "saas-web-application.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: saas-web-application
{{- end }}

{{/*
Selector labels (used by workload + services).
*/}}
{{- define "saas-web-application.selectorLabels" -}}
app.kubernetes.io/name: {{ include "saas-web-application.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
ServiceAccount name.
*/}}
{{- define "saas-web-application.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "saas-web-application.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Application container spec (shared by Deployment and Rollout templates).
*/}}
{{- define "saas-web-application.containers" -}}
- name: {{ .Values.containerName }}
  image: "{{ .Values.image.repository }}:{{ .Values.image.tag | default .Chart.AppVersion }}"
  imagePullPolicy: {{ .Values.image.pullPolicy }}
  ports:
    - name: http
      containerPort: {{ .Values.service.targetPort }}
      protocol: TCP
  envFrom:
    - configMapRef:
        name: {{ include "saas-web-application.fullname" . }}
    - secretRef:
        name: {{ include "saas-web-application.fullname" . }}
  resources:
    {{- toYaml .Values.resources | nindent 4 }}
  {{- with .Values.readinessProbe }}
  readinessProbe:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  {{- with .Values.livenessProbe }}
  livenessProbe:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  {{- with .Values.startupProbe }}
  startupProbe:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  {{- with .Values.lifecycle }}
  lifecycle:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  securityContext:
    allowPrivilegeEscalation: false
    runAsNonRoot: true
    runAsUser: {{ .Values.securityContext.runAsUser }}
    runAsGroup: {{ .Values.securityContext.runAsGroup }}
    capabilities:
      drop: ["ALL"]
    readOnlyRootFilesystem: true
  {{- with .Values.volumeMounts }}
  volumeMounts:
    {{- toYaml . | nindent 4 }}
  {{- end }}
{{- end }}

{{/*
Pod template spec (shared by Deployment and Rollout templates).
*/}}
{{- define "saas-web-application.podSpec" -}}
serviceAccountName: {{ include "saas-web-application.serviceAccountName" . }}
automountServiceAccountToken: false
securityContext:
  seccompProfile:
    type: RuntimeDefault
  runAsNonRoot: true
  runAsUser: {{ .Values.securityContext.runAsUser }}
  fsGroup: {{ .Values.securityContext.runAsGroup }}
containers:
  {{- include "saas-web-application.containers" . | nindent 2 }}
{{- with .Values.volumes }}
volumes:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.nodeSelector }}
nodeSelector:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.affinity }}
affinity:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.topologySpreadConstraints }}
topologySpreadConstraints:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- with .Values.tolerations }}
tolerations:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}
