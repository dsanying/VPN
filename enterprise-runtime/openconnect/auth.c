/* Structured authentication adapter; protocol and form parsing remain in libopenconnect. */
#include <openconnect.h>
#include <json-c/json.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <stdarg.h>
static struct json_object *config;
static struct openconnect_info *connection;
static char *origin;
static int origin_port;
static int probe, password_used, group_set, forms;
static const char *text(struct json_object *o, const char *key) {
 struct json_object *v; return json_object_object_get_ex(o,key,&v) && json_object_is_type(v,json_type_string) ? json_object_get_string(v) : "";
}
static struct json_object *read_input(void) {
 char *line=NULL; size_t size=0; ssize_t n=getline(&line,&size,stdin);
 if(n<0 || n>65536){free(line);return NULL;}
 struct json_object *o=json_tokener_parse(line); memset(line,0,(size_t)n);free(line);
 if(!o || !json_object_is_type(o,json_type_object)){if(o)json_object_put(o);return NULL;}return o;
}
static void emit(struct json_object *o){puts(json_object_to_json_string_ext(o,JSON_C_TO_STRING_PLAIN));fflush(stdout);json_object_put(o);}
static struct json_object *field(struct oc_form_opt *opt){
 struct json_object *f=json_object_new_object();
 json_object_object_add(f,"name",json_object_new_string(opt->name ? opt->name : ""));
 json_object_object_add(f,"label",json_object_new_string(opt->label ? opt->label : opt->name ? opt->name : ""));
 json_object_object_add(f,"secret",json_object_new_boolean(opt->type==OC_FORM_OPT_PASSWORD));
 if(opt->type==OC_FORM_OPT_SELECT){struct oc_form_opt_select *s=(void*)opt;struct json_object *choices=json_object_new_array();
 for(int i=0;i<s->nr_choices;i++){struct json_object *c=json_object_new_object();json_object_object_add(c,"value",json_object_new_string(s->choices[i]->name));json_object_object_add(c,"label",json_object_new_string(s->choices[i]->label ? s->choices[i]->label : s->choices[i]->name));json_object_array_add(choices,c);}json_object_object_add(f,"choices",choices);}
 return f;
}
static int select_value(struct oc_form_opt *opt,const char *value){
 struct oc_form_opt_select *s=(void*)opt;for(int i=0;i<s->nr_choices;i++)if(!strcmp(value,s->choices[i]->name))return openconnect_set_option_value(opt,value);return -1;
}
static int auth(void *priv,struct oc_auth_form *form){
 (void)priv;if (!origin || strcmp(origin,openconnect_get_dnsname(connection)) || origin_port!=openconnect_get_port(connection)) return OC_FORM_RESULT_ERR;
 if(++forms>12)return OC_FORM_RESULT_ERR;
 struct json_object *event=json_object_new_object(), *fields=json_object_new_array(), *saved=NULL;
 json_object_object_get_ex(config,"selections",&saved);
 json_object_object_add(event,"type",json_object_new_string(probe ? "form" : "challenge"));
 json_object_object_add(event,"kind",json_object_new_string("form"));
 /* Group changes can alter the fields: first resolve the group, then ask libopenconnect for the new form. */
 int group_only=!probe && form->authgroup_opt && !group_set;
 for(struct oc_form_opt *o=form->opts;o;o=o->next){
 if(o->flags & OC_FORM_OPT_IGNORE || o->type==OC_FORM_OPT_HIDDEN || o->type==OC_FORM_OPT_TOKEN)continue;
 if(group_only && o!=&form->authgroup_opt->form)continue;
 if(probe){json_object_array_add(fields,field(o));continue;}
 if(o->type==OC_FORM_OPT_SELECT){const char *v=saved ? text(saved,o->name):"";struct oc_form_opt_select *s=(void*)o;
 if(!*v && s->nr_choices==1)v=s->choices[0]->name;
 if(*v && select_value(o,v)==0)continue;
 }else if(o->type==OC_FORM_OPT_TEXT && o->name && !strncmp(o->name,"user",4) && *text(config,"username")){openconnect_set_option_value(o,text(config,"username"));continue;
 }else if(o->type==OC_FORM_OPT_PASSWORD && !password_used && !(o->name && (strstr(o->name,"secondary") || strstr(o->name,"token"))) && *text(config,"password")){openconnect_set_option_value(o,text(config,"password"));password_used=1;continue;}
 else if(o->type!=OC_FORM_OPT_TEXT && o->type!=OC_FORM_OPT_PASSWORD){json_object_put(event);json_object_put(fields);return OC_FORM_RESULT_ERR;}
 json_object_array_add(fields,field(o));
 }
 json_object_object_add(event,"fields",fields);
 if(probe){emit(event);return OC_FORM_RESULT_CANCELLED;}
 if(json_object_array_length(fields)){
 /* Do not forward banners/errors: they can echo credentials or contain executable gateway markup. */
 emit(json_object_get(event));struct json_object *response=read_input(),*values=NULL;
 if(!response || !json_object_object_get_ex(response,"fields",&values)){if(response)json_object_put(response);json_object_put(event);return OC_FORM_RESULT_CANCELLED;}
 for(size_t i=0;i<json_object_array_length(fields);i++){
 const char *name=text(json_object_array_get_idx(fields,i),"name"),*value=text(values,name);if(!*value){json_object_put(response);json_object_put(event);return OC_FORM_RESULT_ERR;}
 for(struct oc_form_opt *o=form->opts;o;o=o->next)if(o->name && !strcmp(name,o->name)){
 if((o->type==OC_FORM_OPT_SELECT ? select_value(o,value) : openconnect_set_option_value(o,value))<0){json_object_put(response);json_object_put(event);return OC_FORM_RESULT_ERR;}
 if(o->type==OC_FORM_OPT_SELECT){if(!saved){saved=json_object_new_object();json_object_object_add(config,"selections",saved);}json_object_object_add(saved,name,json_object_new_string(value));}
 }
 }json_object_put(response);
 }
 json_object_put(event);if(group_only){group_set=1;return OC_FORM_RESULT_NEWGROUP;}return OC_FORM_RESULT_OK;
}
static int reject_cert(void *priv,const char *reason){(void)priv;(void)reason;return -1;}
static void progress(void *priv,int level,const char *fmt,...){(void)priv;(void)level;(void)fmt;/* Raw vendor diagnostics can contain secrets. */}
int main(int argc,char **argv){
 if(argc!=6)return 2;probe=!strcmp(argv[1],"--probe");config=read_input();if(!config)return 2;
 if(openconnect_init_ssl())return 2;
 struct openconnect_info *vpn=openconnect_vpninfo_new("OpenConnect",reject_cert,NULL,auth,progress,NULL);
 if(!vpn)return 2;openconnect_set_system_trust(vpn,1);
 if(openconnect_set_protocol(vpn,argv[2]) || openconnect_parse_url(vpn,argv[3]))return 2;
 connection= vpn; origin=strdup(openconnect_get_dnsname(vpn));origin_port=openconnect_get_port(vpn);
 int result=openconnect_obtain_cookie(vpn);if(probe){openconnect_vpninfo_free(vpn);json_object_put(config);return forms ? 0 : 1;}
 if(result || !openconnect_get_cookie(vpn)){
 puts("{\"type\":\"error\",\"reason\":\"authentication\"}");fflush(stdout);openconnect_vpninfo_free(vpn);json_object_put(config);return 1;
 }
 /* Keep cookies out of argv, environment, disk and renderer. Transfer through an anonymous pipe. */
 int fds[2];if(pipe(fds))return 2;pid_t writer=fork();if(writer<0)return 2;
 if(!writer){close(fds[0]);FILE *out=fdopen(fds[1],"w");if(!out)_exit(2);fprintf(out,"%s\n",openconnect_get_cookie(vpn));fclose(out);_exit(0);}
 close(fds[1]);
 char *resolved=NULL;
 if(asprintf(&resolved,"%s:%s",origin,openconnect_get_hostname(vpn))<0)return 2;
 openconnect_vpninfo_free(vpn);json_object_put(config);
 /* libopenconnect teardown closes its command descriptors; install the cookie input only afterwards. */
 if(dup2(fds[0],STDIN_FILENO)<0)return 2; if(fds[0]!=STDIN_FILENO)close(fds[0]);
 char *args[]={argv[4],"--protocol",argv[2],"--no-proxy","--non-inter","--cookie-on-stdin","--resolve",resolved,"--script-tun","--script",argv[5],argv[3],NULL};
 execv(argv[4],args);return 2;
}
